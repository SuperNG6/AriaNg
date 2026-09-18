(function () {
    'use strict';

    angular.module('ariaNg').controller('DownloadListController', ['$rootScope', '$scope', '$window', '$location', '$route', '$interval', '$timeout', 'dragulaService', 'aria2RpcErrors', 'ariaNgCommonService', 'ariaNgSettingService', 'ariaNgBtFileFilterService', 'aria2TaskService', function ($rootScope, $scope, $window, $location, $route, $interval, $timeout, dragulaService, aria2RpcErrors, ariaNgCommonService, ariaNgSettingService, ariaNgBtFileFilterService, aria2TaskService) {
        var location = $location.path().substring(1);
        var downloadTaskRefreshPromise = null;
        var pauseDownloadTaskRefresh = false;
        var needRequestWholeInfo = true;
        // 模式代数拒绝切换视图前的回包；请求序号另行拒绝同一模式中乱序到达的旧结果。
        var downloadTaskModeGeneration = 0;
        var downloadTaskRequestId = 0;
        var latestAppliedDownloadTaskRequestId = 0;
        // 文件结构较大，按 5 秒节流；普通进度仍按用户配置刷新，并复用已有文件行。
        var taskFileListRefreshInterval = 5000;
        var lastTaskFileListRequestTime = null;
        var pendingWholeInfoRequestId = null;
        var pendingWholeInfoRequestTime = null;
        // 把全量请求绑定到批次完成编号，避免用过滤完成前发出的请求解除“正在分析”。
        var pendingWholeInfoCompletionId = null;
        var pendingWholeInfoTimeout = 30000;
        var bulkPreviewTimeoutPromise = null;
        var bulkCompletionRefreshTimeoutPromise = null;
        var pendingBulkPreviewCompletionId = null;
        var megabyte = 1024 * 1024;

        var collapsedFileDirs = {};

        $scope.bulkBtFilterContext = $scope.btFileFilterContext || {
            minSizeMb: ariaNgSettingService.getBtFileFilterMinSizeMb()
        };
        $scope.bulkBtFilterPreview = {gids: [], taskCount: 0, fileCount: 0, analyzing: true};
        $scope.bulkBtFilterStatus = ariaNgBtFileFilterService.getBulkStatus();
        if ($scope.bulkBtFilterStatus.type === 'complete') {
            pendingBulkPreviewCompletionId = $scope.bulkBtFilterStatus.completionId;
        }

        $scope.showBulkBtFilterAction = function () {
            return location === 'downloading' && $scope.showTaskListFileList();
        };

        $scope.isBulkBtFileFilterValid = function () {
            var value = Number($scope.bulkBtFilterContext.minSizeMb);
            return isFinite(value) && value >= 1 && value <= 102400 && value === Math.floor(value);
        };

        // 只在数据或阈值变化时计算预览，模板读取缓存，避免每轮 digest 扫描所有文件。
        var updateBulkBtFilterPreview = function (tasks) {
            if (bulkPreviewTimeoutPromise) {
                $timeout.cancel(bulkPreviewTimeoutPromise);
                bulkPreviewTimeoutPromise = null;
            }
            if (!$scope.showBulkBtFilterAction() || !$scope.isBulkBtFileFilterValid()) {
                $scope.bulkBtFilterPreview = {gids: [], taskCount: 0, fileCount: 0, analyzing: false};
                return;
            }

            var preview = ariaNgBtFileFilterService.getBulkPreview(tasks || [],
                Number($scope.bulkBtFilterContext.minSizeMb) * megabyte);
            preview.analyzing = false;
            $scope.bulkBtFilterPreview = preview;
        };

        $scope.changeBulkBtFileFilterThreshold = function () {
            if (bulkPreviewTimeoutPromise) {
                $timeout.cancel(bulkPreviewTimeoutPromise);
                bulkPreviewTimeoutPromise = null;
            }
            if (!$scope.isBulkBtFileFilterValid()) {
                $scope.bulkBtFilterPreview = {gids: [], taskCount: 0, fileCount: 0, analyzing: false};
                return;
            }
            ariaNgSettingService.setBtFileFilterMinSizeMb($scope.bulkBtFilterContext.minSizeMb);
            $scope.bulkBtFilterPreview.analyzing = true;
            if (pendingBulkPreviewCompletionId !== null) {
                scheduleBulkCompletionRefresh();
            }
            bulkPreviewTimeoutPromise = $timeout(function () {
                bulkPreviewTimeoutPromise = null;
                if (pendingBulkPreviewCompletionId !== null) {
                    return;
                }
                updateBulkBtFilterPreview($rootScope.taskContext.list);
            }, 200);
        };

        $scope.startBulkBtFileFilter = function () {
            if (!$scope.isBulkBtFileFilterValid() || $scope.bulkBtFilterStatus.type !== 'idle' ||
                $scope.bulkBtFilterPreview.analyzing || $scope.bulkBtFilterPreview.taskCount < 1) {
                return;
            }

            var thresholdBytes = Number($scope.bulkBtFilterContext.minSizeMb) * megabyte;
            var gids = $scope.bulkBtFilterPreview.gids.slice();
            ariaNgCommonService.confirm('format.bt-file-filter.bulk.confirm-title',
                'format.bt-file-filter.bulk.confirm-text', 'warning', function () {
                    if (!ariaNgBtFileFilterService.enqueueBulk(gids, thresholdBytes)) {
                        ariaNgCommonService.showError('format.bt-file-filter.bulk.enqueue-failed');
                    }
                }, false, {
                    multilineText: true,
                    textParams: {
                        count: gids.length,
                        files: $scope.bulkBtFilterPreview.fileCount,
                        threshold: $scope.bulkBtFilterContext.minSizeMb
                    }
                });
        };

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

        var cancelBulkCompletionRefresh = function () {
            if (bulkCompletionRefreshTimeoutPromise) {
                $timeout.cancel(bulkCompletionRefreshTimeoutPromise);
                bulkCompletionRefreshTimeoutPromise = null;
            }
        };

        // 即使用户关闭周期刷新，批量完成也要获取新文件选择；请求超时后继续重试，不能依赖提示条存活。
        var scheduleBulkCompletionRefresh = function (delay) {
            needRequestWholeInfo = true;
            if (bulkCompletionRefreshTimeoutPromise) {
                return;
            }
            bulkCompletionRefreshTimeoutPromise = $timeout(function () {
                bulkCompletionRefreshTimeoutPromise = null;
                if (pendingBulkPreviewCompletionId === null) {
                    return;
                }
                if (pendingWholeInfoRequestId !== null && pendingWholeInfoRequestTime !== null) {
                    var pendingElapsed = $window.Date.now() - pendingWholeInfoRequestTime;
                    if (pendingElapsed >= 0 && pendingElapsed < pendingWholeInfoTimeout) {
                        scheduleBulkCompletionRefresh(pendingWholeInfoTimeout - pendingElapsed);
                        return;
                    }
                }
                $rootScope.loadPromise = refreshDownloadTask(false);
                if (pendingWholeInfoRequestId !== null &&
                    pendingWholeInfoCompletionId === pendingBulkPreviewCompletionId) {
                    scheduleBulkCompletionRefresh(pendingWholeInfoTimeout);
                }
            }, typeof delay === 'number' ? delay : 0);
        };

        // 空映射也必须遍历任务并清理旧字段，否则停止服务后旧徽标会残留。
        var decorateBtFilterStage = function (tasks) {
            var stageMap = ariaNgBtFileFilterService.getPendingGidStageMap();
            for (var i = 0; tasks && i < tasks.length; i++) {
                var task = tasks[i];

                if (stageMap.hasOwnProperty(task.gid)) {
                    task.btFilterStage = stageMap[task.gid];
                } else if (task.btFilterStage) {
                    delete task.btFilterStage;
                }
            }
        };

        // 重建目录树前还原真实文件列表，避免把上轮生成的目录再次作为输入。
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
                var pendingElapsed = pendingWholeInfoRequestTime === null
                    ? Number.POSITIVE_INFINITY
                    : currentTime - pendingWholeInfoRequestTime;

                // A lost RPC response (e.g. a WebSocket closed with auto-reconnect
                // disabled, whose pending callback never fires) would otherwise
                // freeze every later refresh. Expire a stale pending request, and
                // also recover if the wall clock rolls backward.
                if (pendingElapsed >= 0 && pendingElapsed < pendingWholeInfoTimeout) {
                    return;
                }

                pendingWholeInfoRequestId = null;
                pendingWholeInfoRequestTime = null;
                pendingWholeInfoCompletionId = null;
            }

            var requestId = ++downloadTaskRequestId;
            var requestBulkCompletionId = requestWholeInfo ? pendingBulkPreviewCompletionId : null;

            if (requestWholeInfo && showFileList && location === 'downloading') {
                lastTaskFileListRequestTime = currentTime;
            }
            if (requestWholeInfo) {
                pendingWholeInfoRequestId = requestId;
                pendingWholeInfoRequestTime = currentTime;
                pendingWholeInfoCompletionId = requestBulkCompletionId;
            }

            return aria2TaskService.getTaskList(location, requestWholeInfo, function (response) {
                if (pendingWholeInfoRequestId === requestId) {
                    pendingWholeInfoRequestId = null;
                    pendingWholeInfoRequestTime = null;
                    pendingWholeInfoCompletionId = null;
                }

                if (pauseDownloadTaskRefresh || modeGeneration !== downloadTaskModeGeneration || requestId <= latestAppliedDownloadTaskRequestId) {
                    return;
                }

                if (!response.success) {
                    if (response.data.message === aria2RpcErrors.Unauthorized.message) {
                        $interval.cancel(downloadTaskRefreshPromise);
                        cancelBulkCompletionRefresh();
                    } else if (pendingBulkPreviewCompletionId !== null) {
                        cancelBulkCompletionRefresh();
                        scheduleBulkCompletionRefresh(5000);
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

                    if (pendingBulkPreviewCompletionId === null ||
                        requestBulkCompletionId === pendingBulkPreviewCompletionId) {
                        updateBulkBtFilterPreview(taskList);
                        if (requestBulkCompletionId !== null) {
                            pendingBulkPreviewCompletionId = null;
                            cancelBulkCompletionRefresh();
                        }
                    }

                    if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                        removeVirtualFileNodes($rootScope.taskContext.list);
                        aria2TaskService.processDownloadTasks($rootScope.taskContext.list, showFileList);
                    }
                } else {
                    if ($rootScope.taskContext.list && $rootScope.taskContext.list.length > 0) {
                        for (var i = 0; i < $rootScope.taskContext.list.length; i++) {
                            var task = $rootScope.taskContext.list[i];
                            // 校验结束时 RPC 会省略这些字段；合并前必须清除，否则旧的“正在校验”状态会一直保留。
                            delete task.verifiedLength;
                            delete task.verifyIntegrityPending;
                        }
                    }

                    aria2TaskService.processDownloadTasks(taskList, false);

                    for (i = 0; i < taskList.length; i++) {
                        // 增量数据缺少完整文件信息，保留全量响应计算的任务名，避免临时名称覆盖它。
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

                        for (i = 0; i < $rootScope.taskContext.list.length; i++) {
                            task = $rootScope.taskContext.list[i];

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

                if (isRequestWholeInfo &&
                    pendingBulkPreviewCompletionId !== null &&
                    requestBulkCompletionId !== pendingBulkPreviewCompletionId) {
                    scheduleBulkCompletionRefresh();
                }
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

        $scope.$on('task-list.drop-model', function (el, target) {
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
            pendingWholeInfoRequestTime = null;
            pendingWholeInfoCompletionId = null;
            $scope.bulkBtFilterPreview.analyzing = !!enabled && location === 'downloading';
            $rootScope.loadPromise = refreshDownloadTask(false);
        });

        $scope.$on('bt-file-filter.stopped', function () {
            decorateBtFilterStage($rootScope.taskContext.list);
        });

        var stopWatchingBulkCompletion = $scope.$watch('bulkBtFilterStatus.type', function (newValue, oldValue) {
            if (location === 'downloading' && newValue === 'complete' && oldValue !== 'complete') {
                cancelBulkCompletionRefresh();
                pendingBulkPreviewCompletionId = $scope.bulkBtFilterStatus.completionId;
                $scope.bulkBtFilterPreview.analyzing = true;
                if (pendingWholeInfoRequestId !== null &&
                    pendingWholeInfoCompletionId !== pendingBulkPreviewCompletionId) {
                    pendingWholeInfoRequestId = null;
                    pendingWholeInfoRequestTime = null;
                    pendingWholeInfoCompletionId = null;
                }
                scheduleBulkCompletionRefresh();
            } else if (pendingBulkPreviewCompletionId === null) {
                cancelBulkCompletionRefresh();
            }
        });

        if (location === 'downloading' && $scope.bulkBtFilterStatus.type === 'complete') {
            scheduleBulkCompletionRefresh();
        }

        // 路由离开时同时阻止迟到回包写入共享列表，并取消本控制器拥有的定时器和监听。
        $scope.$on('$destroy', function () {
            pauseDownloadTaskRefresh = true;

            if (downloadTaskRefreshPromise) {
                $interval.cancel(downloadTaskRefreshPromise);
            }
            if (bulkPreviewTimeoutPromise) {
                $timeout.cancel(bulkPreviewTimeoutPromise);
            }
            cancelBulkCompletionRefresh();
            stopWatchingBulkCompletion();
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
        };

        $rootScope.loadPromise = refreshDownloadTask(false);
    }]);
}());
