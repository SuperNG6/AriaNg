(function () {
    'use strict';

    angular.module('ariaNg').factory('aria2WebSocketRpcService', ['$q', '$websocket', '$timeout', 'ariaNgConstants', 'ariaNgSettingService', 'ariaNgLogService', function ($q, $websocket, $timeout, ariaNgConstants, ariaNgSettingService, ariaNgLogService) {
        var websocketStatusConnecting = 0;
        var websocketStatusOpen = 1;

        var rpcUrl = ariaNgSettingService.getCurrentRpcUrl();
        var socketClient = null;
        var pendingReconnect = null;
        var socketClosedWithoutAutoReconnect = false;

        var sendIdStates = {};
        var eventCallbacks = {};
        var responseGeneration = 0;

        // Keep unsent requests here, not in angular-websocket's reconnect queue.
        // Rejecting our callback must also prevent a later network mutation.
        // 只向已打开的 socket 发送，避免底层库把请求暗中排队，在上层已报告失败后重连重放写操作。
        var sendRequest = function (state) {
            if (!state || state.sent || !socketClient || socketClient.readyState !== websocketStatusOpen) {
                return;
            }
            state.sent = true;
            var requestBody = angular.toJson(state.context.requestBody);
            try {
                socketClient.send(requestBody);
            } catch (error) {
                processRequestFailed(requestBody);
            }
        };

        var sendPendingRequests = function () {
            for (var uniqueId in sendIdStates) {
                if (!sendIdStates.hasOwnProperty(uniqueId)) {
                    continue;
                }
                sendRequest(sendIdStates[uniqueId]);
            }
        };

        // 先移除请求并取消期限，再调用业务回调；超时、断线和迟到响应只能结算一次。
        var takePendingRequest = function (uniqueId) {
            var state = sendIdStates[uniqueId];
            if (state) {
                delete sendIdStates[uniqueId];
                $timeout.cancel(state.timeout);
            }
            return state;
        };

        var failRequest = function (uniqueId, timedOut) {
            var state = takePendingRequest(uniqueId);
            if (!state) {
                return;
            }
            var context = state.context;
            state.deferred.reject({success: false, context: context});
            // A deadline without any newer RPC reply means the open socket is not usable.
            // An unrelated stalled request must not override a later healthy reply.
            if (timedOut && state.responseGeneration === responseGeneration && socketClient &&
                (socketClient.readyState === websocketStatusConnecting ||
                    socketClient.readyState === websocketStatusOpen) && context.connectionFailedCallback) {
                context.connectionFailedCallback({rpcUrl: rpcUrl});
            }
            if (context.errorCallback) {
                ariaNgLogService.debug('[aria2WebSocketRpcService.failRequest] request failed', context);
                context.errorCallback(context.id, {message: 'Cannot connect to aria2!'});
            }
        };

        var rejectPendingRequests = function () {
            for (var uniqueId in sendIdStates) {
                if (sendIdStates.hasOwnProperty(uniqueId)) {
                    failRequest(uniqueId);
                }
            }
        };

        var processRequestFailed = function (request) {
            var content = angular.fromJson(request);
            if (content && content.id) {
                failRequest(content.id);
            }
        };

        var processMethodCallback = function (content) {
            var uniqueId = content.id;

            if (!uniqueId) {
                return;
            }

            var state = takePendingRequest(uniqueId);

            if (!state) {
                return;
            }

            var context = state.context;
            responseGeneration++;

            state.deferred.resolve({
                success: true,
                context: context
            });

            if (content.result && context.connectionSuccessCallback) {
                context.connectionSuccessCallback({
                    rpcUrl: rpcUrl
                });
            }

            if (content.result && context.successCallback) {
                ariaNgLogService.debug('[aria2WebSocketRpcService.processMethodCallback] ' + (context && context.requestBody && context.requestBody.method ? context.requestBody.method + ' ' : '') + 'response success', content);

                context.successCallback(context.id, content.result);
            }

            if (content.error && context.errorCallback) {
                ariaNgLogService.debug('[aria2WebSocketRpcService.processMethodCallback] ' + (context && context.requestBody && context.requestBody.method ? context.requestBody.method + ' ' : '') + 'response error', content);

                context.errorCallback(context.id, content.error);
            }
        };

        var processEventCallback = function (content) {
            var method = content.method;

            if (!method) {
                return;
            }

            var callbacks = eventCallbacks[method];

            if (!angular.isArray(callbacks) || callbacks.length < 1) {
                return;
            }

            for (var i = 0; i < callbacks.length; i++) {
                var callback = callbacks[i];
                var context = (angular.isArray(content.params) && content.params.length > 0 ? content.params[0] : null);
                callback(context);
            }
        };

        var getSocketClient = function (context) {
            if (socketClient === null) {
                try {
                    socketClosedWithoutAutoReconnect = false;

                    socketClient = $websocket(rpcUrl, {
                        maxTimeout: 1, // ms
                        reconnectInterval: ariaNgSettingService.getWebSocketReconnectInterval()
                    });

                    socketClient.onMessage(function (message) {
                        if (!message || !message.data) {
                            if (message.request) {
                                processRequestFailed(message.request);
                            }
                            return;
                        }

                        var content = angular.fromJson(message.data);

                        if (!content) {
                            return;
                        }

                        if (content.id) {
                            processMethodCallback(content);
                        } else if (content.method) {
                            processEventCallback(content);
                        }
                    });

                    socketClient.onOpen(function (e) {
                        ariaNgLogService.debug('[aria2WebSocketRpcService.onOpen] websocket is opened', e);
                        socketClosedWithoutAutoReconnect = false;
                        sendPendingRequests();

                        if (context && context.connectionSuccessCallback) {
                            context.connectionSuccessCallback({
                                rpcUrl: rpcUrl
                            });
                        }
                    });

                    socketClient.onClose(function (e) {
                        ariaNgLogService.warn('[aria2WebSocketRpcService.onClose] websocket is closed', e);

                        var enableAutoReconnect = ariaNgSettingService.getWebSocketReconnectInterval() > 0;

                        if (enableAutoReconnect) {
                            planToReconnect(context);
                        } else {
                            socketClosedWithoutAutoReconnect = true;
                            rejectPendingRequests();
                        }

                        if (enableAutoReconnect && context && context.connectionWaitingToReconnectCallback) {
                            context.connectionWaitingToReconnectCallback({
                                rpcUrl: rpcUrl
                            });
                        } else if (context && context.connectionFailedCallback) {
                            context.connectionFailedCallback({
                                rpcUrl: rpcUrl
                            });
                        }
                    });
                } catch (ex) {
                    return {
                        success: false,
                        error: 'Cannot initialize WebSocket!',
                        exception: ex
                    };
                }
            }

            return {
                success: true,
                instance: socketClient
            };
        };

        var reconnect = function (context) {
            if (!context || !socketClient) {
                return;
            }

            rejectPendingRequests();

            if (context.connectionReconnectingCallback) {
                context.connectionReconnectingCallback({
                    rpcUrl: rpcUrl
                });
            }

            socketClient.reconnect();
        };

        var planToReconnect = function (context) {
            if (pendingReconnect) {
                ariaNgLogService.warn('[aria2WebSocketRpcService.planToReconnect] another reconnection is pending');
                return;
            }

            pendingReconnect = $timeout(function () {
                if (socketClient == null) {
                    ariaNgLogService.warn('[aria2WebSocketRpcService.planToReconnect] websocket is null');
                    pendingReconnect = null;
                    return;
                }

                if (socketClient.readyState === websocketStatusConnecting || socketClient.readyState === websocketStatusOpen) {
                    ariaNgLogService.warn('[aria2WebSocketRpcService.planToReconnect] websocket current state is already ' + socketClient.readyState);
                    pendingReconnect = null;
                    return;
                }

                reconnect(context);
                pendingReconnect = null;
            }, ariaNgSettingService.getWebSocketReconnectInterval());

            ariaNgLogService.debug('[aria2WebSocketRpcService.planToReconnect] next reconnection is pending in ' + ariaNgSettingService.getWebSocketReconnectInterval() + 'ms');
        };

        return {
            request: function (context) {
                if (!context) {
                    return;
                }

                var client = getSocketClient({
                    connectionSuccessCallback: context.connectionSuccessCallback,
                    connectionFailedCallback: context.connectionFailedCallback,
                    connectionReconnectingCallback: context.connectionReconnectingCallback,
                    connectionWaitingToReconnectCallback: context.connectionWaitingToReconnectCallback
                });
                var uniqueId = context.uniqueId;

                ariaNgLogService.debug('[aria2WebSocketRpcService.request] ' + (context && context.requestBody && context.requestBody.method ? context.requestBody.method + ' ' : '') + 'request start', context);

                var deferred = $q.defer();

                if (client.instance && !socketClosedWithoutAutoReconnect) {
                    sendIdStates[uniqueId] = {
                        context: context,
                        deferred: deferred,
                        sent: false,
                        responseGeneration: responseGeneration,
                        // 连接中等待发送也计入期限。超时只报告失败，不重放可能已执行的写操作；
                        // 过滤协调器收到失败后释放当前轮次，再通过回读服务器状态决定下一步。
                        timeout: $timeout(function () {
                            failRequest(uniqueId, true);
                        }, ariaNgConstants.webSocketRequestTimeout)
                    };

                    sendRequest(sendIdStates[uniqueId]);
                } else {
                    deferred.reject({
                        success: false,
                        context: context
                    });

                    ariaNgLogService.debug('[aria2WebSocketRpcService.request] client error', client);
                    context.errorCallback(context.id, { message: client.error || 'Cannot connect to aria2!' });
                }

                return deferred.promise;
            },
            reconnect: function (context) {
                reconnect(context);
            },
            on: function (eventName, callback) {
                var callbacks = eventCallbacks[eventName];

                if (!angular.isArray(callbacks)) {
                    callbacks = eventCallbacks[eventName] = [];
                }

                callbacks.push(callback);
            }
        };
    }]);
}());
