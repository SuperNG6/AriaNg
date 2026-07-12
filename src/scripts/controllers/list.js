(function () {
    'use strict';

    angular.module('ariaNg').controller('DownloadListController', ['$rootScope', '$scope', '$window', '$location', '$route', '$interval', 'dragulaService', 'aria2RpcErrors', 'ariaNgCommonService', 'ariaNgSettingService', 'ariaNgBtFileFilterService', 'aria2TaskService', function ($rootScope, $scope, $window, $location, $route, $interval, dragulaService, aria2RpcErrors, ariaNgCommonService, ariaNgSettingService, ariaNgBtFileFilterService, aria2TaskService) {
        var location = $location.path().substring(1);
        var downloadTaskRefreshPromise = null;
        var pauseDownloadTaskRefresh = false;
        var needRequestWholeInfo = true;
        var downloadTaskModeGeneration = 0;
        var downloadTaskRequestId = 0;
        var latestAppliedDownloadTaskRequestId = 0;
        var taskFileListRefreshInterval = 5000;
        var lastTaskFileListRequestTime = null;
        var pendingWholeInfoRequestId = null;

        var collapsedFileDirs = {};

        var getCollapsedFileDirs = function (task) {
            if (!task || !task.gid) {
                return {};
            }

            if (!collapsedFileDirs[task.gid]) {
                collapsedFileDirs[task.gid] = {};
            }

            return collapsedFileDirs[task.gid];
        };

        var cleanupCollapsedFileDirs = function (tasks) {
            var activeTaskIds = {};

            for (var i = 0; tasks && i < tasks.length; i++) {
                activeTaskIds[tasks[i].gid] = true;
            }

            for (var gid in collapsedFileDirs) {
                if (collapsedFileDirs.hasOwnProperty(gid) && !activeTaskIds[gid]) {
                    delete collapsedFileDirs[gid];
                }
            }
        };

        var decorateBtFilterStage = function (tasks) {
            var stageMap = ariaNgBtFileFilterService.getPendingGidStageMap();
            var hasAny = false;

            for (var key in stageMap) {
                if (stageMap.hasOwnProperty(key)) {
                    hasAny = true;
                    break;
                }
            }

            for (var i = 0; tasks && i < tasks.length; i++) {
                var task = tasks[i];

                if (hasAny && stageMap.hasOwnProperty(task.gid)) {
                    task.btFilterStage = stageMap[task.gid];
                } else if (task.btFilterStage) {
                    delete task.btFilterStage;
                }
            }
        };

        var removeVirtualFileNodes = function (tasks) {
            for (var i = 0; tasks && i < tasks.length; i++) {
                var task = tasks[i];

                if (!task.multiDir || !task.files) {
                    continue;
                }

                var files = [];

                for (var j = 0; j < task.files.length; j++) {
                    var file = task.files[j];

                    if (!file.isDir) {
                        delete file.relativePath;
                        delete file.level;
                        files.push(file);
                    }
                }

                task.files = files;
                delete task.multiDir;
            }
        };

        var refreshDownloadTask = function (silent) {
            if (pauseDownloadTaskRefresh) {
                return;
            }

            var showFileList = $scope.showTaskListFileList();
            var currentTime = $window.Date.now();
            var refreshTaskFileList = showFileList && location === 'downloading'
                && (lastTaskFileListRequestTime === null || currentTime < lastTaskFileListRequestTime
                    || currentTime - lastTaskFileListRequestTime >= taskFileListRefreshInterval);
            var requestWholeInfo = needRequestWholeInfo || refreshTaskFileList;
            var modeGeneration = downloadTaskModeGeneration;

            if (pendingWholeInfoRequestId !== null) {
                return;
            }

            var requestId = ++downloadTaskRequestId;

            if (requestWholeInfo && showFileList && location === 'downloading') {
                lastTaskFileListRequestTime = currentTime;
            }
            if (requestWholeInfo) {
                pendingWholeInfoRequestId = requestId;
            }

            return aria2TaskService.getTaskList(location, requestWholeInfo, function (response) {
                if (pendingWholeInfoRequestId === requestId) {
                    pendingWholeInfoRequestId = null;
                }

                if (pauseDownloadTaskRefresh || modeGeneration !== downloadTaskModeGeneration || requestId <= latestAppliedDownloadTaskRequestId) {
                    return;
                }

                if (!response.success) {
                    if (response.data.message === aria2RpcErrors.Unauthorized.message) {
                        $interval.cancel(downloadTaskRefreshPromise);
                    }

                    return;
                }

                showFileList = $scope.showTaskListFileList();
                latestAppliedDownloadTaskRequestId = requestId;

                var isRequestWholeInfo = response.context.requestWholeInfo;
                var taskList = response.data;

                if (isRequestWholeInfo) {
                    $rootScope.taskContext.list = taskList;
                    needRequestWholeInfo = false;

                    if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                        removeVirtualFileNodes($rootScope.taskContext.list);
                        aria2TaskService.processDownloadTasks($rootScope.taskContext.list, showFileList);
                    }
                } else {
                    if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                        for (var i = 0; i < $rootScope.taskContext.list.length; i++) {
                            var task = $rootScope.taskContext.list[i];
                            delete task.verifiedLength;
                            delete task.verifyIntegrityPending;
                        }
                    }

                    aria2TaskService.processDownloadTasks(taskList, false);

                    for (var i = 0; i < taskList.length; i++) {
                        delete taskList[i].taskName;
                        delete taskList[i].hasTaskName;
                    }

                    if (ariaNgCommonService.extendArray(taskList, $rootScope.taskContext.list, 'gid')) {
                        needRequestWholeInfo = false;
                    } else {
                        needRequestWholeInfo = true;
                    }
                }

                if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                    if (!isRequestWholeInfo && !showFileList) {
                        removeVirtualFileNodes($rootScope.taskContext.list);
                    }

                    if (!isRequestWholeInfo) {
                        var hasFullStruct = false;

                        for (var i = 0; i < $rootScope.taskContext.list.length; i++) {
                            var task = $rootScope.taskContext.list[i];

                            if (task.hasTaskName || task.files || task.bittorrent) {
                                hasFullStruct = true;
                                break;
                            }
                        }

                        if (!hasFullStruct) {
                            needRequestWholeInfo = true;
                            $rootScope.taskContext.list.length = 0;
                            return;
                        }
                    }
                }

                decorateBtFilterStage($rootScope.taskContext.list);
                cleanupCollapsedFileDirs($rootScope.taskContext.list);
                $rootScope.taskContext.enableSelectAll = $rootScope.taskContext.list && $rootScope.taskContext.list.length > 0;
            }, silent);
        };

        $scope.getOrderType = function () {
            return ariaNgSettingService.getDisplayOrder(location);
        };

        $scope.showTaskListFileList = function () {
            return ariaNgSettingService.getShowFileListInTaskListPage();
        };

        $scope.changeTaskListFileListDisplayOrder = function (task, type, autoSetReverse) {
            if (task && task.multiDir) {
                return;
            }

            var oldType = ariaNgCommonService.parseOrderType(ariaNgSettingService.getFileListDisplayOrder());
            var newType = ariaNgCommonService.parseOrderType(type);

            if (autoSetReverse && newType.type === oldType.type) {
                newType.reverse = !oldType.reverse;
            }

            ariaNgSettingService.setFileListDisplayOrder(newType.getValue());
        };

        $scope.isSetTaskListFileListDisplayOrder = function (type) {
            var orderType = ariaNgCommonService.parseOrderType(ariaNgSettingService.getFileListDisplayOrder());
            var targetType = ariaNgCommonService.parseOrderType(type);

            return orderType.equals(targetType);
        };

        $scope.getTaskListFileListOrderType = function (task) {
            return task && task.multiDir ? null : ariaNgSettingService.getFileListDisplayOrder();
        };

        $scope.isTaskListFileDirCollapsed = function (task, nodePath) {
            return !!getCollapsedFileDirs(task)[nodePath];
        };

        $scope.collapseTaskListFileDir = function (task, dirNode, newValue, forceRecurse) {
            var taskCollapsedDirs = getCollapsedFileDirs(task);
            var nodePath = dirNode.nodePath;

            if (angular.isUndefined(newValue)) {
                newValue = !taskCollapsedDirs[nodePath];
            }

            if (newValue || forceRecurse) {
                for (var i = 0; i < dirNode.subDirs.length; i++) {
                    $scope.collapseTaskListFileDir(task, dirNode.subDirs[i], newValue);
                }
            }

            if (nodePath) {
                taskCollapsedDirs[nodePath] = newValue;
            }
        };

        $scope.isSupportDragTask = function () {
            if (!ariaNgSettingService.getDragAndDropTasks()) {
                return false;
            }

            var displayOrder = ariaNgCommonService.parseOrderType(ariaNgSettingService.getDisplayOrder(location));

            return location === 'waiting' && displayOrder.type === 'default';
        };

        if (ariaNgSettingService.getDownloadTaskRefreshInterval() > 0) {
            downloadTaskRefreshPromise = $interval(function () {
                refreshDownloadTask(true);
            }, ariaNgSettingService.getDownloadTaskRefreshInterval());
        }

        dragulaService.options($scope, 'task-list', {
            revertOnSpill: true,
            moves: function () {
                return $scope.isSupportDragTask();
            }
        });

        $scope.$on('task-list.drop-model', function (el, target, source) {
            var element = angular.element(target);
            var gid = element.attr('data-gid');
            var index = element.index();

            pauseDownloadTaskRefresh = true;

            aria2TaskService.changeTaskPosition(gid, index, function () {
                pauseDownloadTaskRefresh = false;
            }, true);
        });

        $scope.$on('task-list-file-list-mode.changed', function (event, enabled) {
            downloadTaskModeGeneration++;
            needRequestWholeInfo = !!enabled;
            pendingWholeInfoRequestId = null;
            $rootScope.loadPromise = refreshDownloadTask(false);
        });

        $scope.$on('$destroy', function () {
            pauseDownloadTaskRefresh = true;

            if (downloadTaskRefreshPromise) {
                $interval.cancel(downloadTaskRefreshPromise);
            }
        });

        $rootScope.keydownActions.selectAll = function (event) {
            if (event.preventDefault) {
                event.preventDefault();
            }

            $scope.$apply(function () {
                $scope.selectAllTasks();
            });

            return false;
        };

        $rootScope.keydownActions.delete = function (event) {
            if (event.preventDefault) {
                event.preventDefault();
            }

            $scope.$apply(function () {
                $scope.removeTasks();
            });

            return false;
        }

        $rootScope.loadPromise = refreshDownloadTask(false);
    }]);
}());
