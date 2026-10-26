(function () {
    'use strict';

    angular.module('ariaNg').controller('NewTaskController', ['$rootScope', '$scope', '$location', '$timeout', 'ariaNgCommonService', 'ariaNgLogService', 'ariaNgKeyboardService', 'ariaNgFileService', 'ariaNgSettingService', 'ariaNgBtFileFilterService', 'aria2TaskService', 'aria2SettingService', function ($rootScope, $scope, $location, $timeout, ariaNgCommonService, ariaNgLogService, ariaNgKeyboardService, ariaNgFileService, ariaNgSettingService, ariaNgBtFileFilterService, aria2TaskService, aria2SettingService) {
        var tabItems = ['links', 'options'];
        var parameters = $location.search();
        // 页面创建时绑定当前连接身份，异步提交期间编辑连接配置不能把路径历史写到另一服务器。
        var downloadPathHistoryScope = ariaNgSettingService.getCurrentRpcIdentity();

        // 只写当前连接的历史；全局历史仅作升级前数据的只读回退，继续写入会把本机路径推荐给其他服务器。
        var saveDownloadPath = function (options) {
            if (!options || !options.dir) {
                return;
            }

            aria2SettingService.addSettingHistory('dir', options.dir, downloadPathHistoryScope);
        };

        var getRememberedDownloadPathOptions = function () {
            var history = aria2SettingService.getScopedSettingHistory('dir', downloadPathHistoryScope);

            if (!history || !history.length || typeof history[0] !== 'string' || !history[0]) {
                return {};
            }

            return {
                dir: history[0]
            };
        };

        // 链接页的下载路径输入框清空后会留下空字符串；提交副本中去掉它，与选项页一致地回退到 aria2 全局目录。
        // RPC 层也会丢弃空的必填项；这里另需覆盖导出命令。首尾空白已由 Angular 文本输入框的 ngTrim 去掉。
        var getSubmissionOptions = function () {
            var options = angular.copy($scope.context.options);

            if (angular.isDefined(options.dir) && !String(options.dir || '').trim()) {
                delete options.dir;
            }

            return options;
        };

        // 每个 URL 使用独立选项副本；元数据必须先运行，pause-metadata 只让后续 BT 内容停下来等待过滤。
        var getDownloadTasksByLinks = function (options, pauseOnAdded, filterIntent) {
            var urls = ariaNgCommonService.parseUrlsFromOriginInput($scope.context.urls);
            var tasks = [];

            if (!options) {
                options = getSubmissionOptions();
            }

            for (var i = 0; i < urls.length; i++) {
                if (urls[i] === '' || urls[i].trim() === '') {
                    continue;
                }

                var url = urls[i].trim();
                var task = {
                    urls: [url],
                    options: angular.copy(options)
                };

                if (filterIntent && filterIntent.enabled && ariaNgBtFileFilterService.isBtMetadataUrl(url)) {
                    task.options['pause-metadata'] = 'true';
                    task.options.pause = 'false';
                    task.pauseOnAdded = false;
                    task.btFileFilterCandidate = true;
                    task.btFileFilterSourceType = /^magnet:/i.test(url) ? 'magnet' : 'remote-torrent';
                } else if (angular.isDefined(pauseOnAdded)) {
                    task.pauseOnAdded = !!pauseOnAdded;
                }

                tasks.push(task);
            }

            return tasks;
        };

        var downloadByLinks = function (pauseOnAdded, filterIntent, responseCallback) {
            var options = getSubmissionOptions();
            var tasks = getDownloadTasksByLinks(options, pauseOnAdded, filterIntent);

            saveDownloadPath(options);

            return aria2TaskService.newUriTasks(tasks, pauseOnAdded, responseCallback);
        };

        var downloadByTorrent = function (pauseOnAdded, responseCallback) {
            var options = getSubmissionOptions();

            var task = {
                content: $scope.context.uploadFile.base64Content,
                options: options
            };

            saveDownloadPath(task.options);

            return aria2TaskService.newTorrentTask(task, pauseOnAdded, responseCallback);
        };

        var downloadByMetalink = function (pauseOnAdded, responseCallback) {
            var task = {
                content: $scope.context.uploadFile.base64Content,
                options: getSubmissionOptions()
            };

            saveDownloadPath(task.options);

            return aria2TaskService.newMetalinkTask(task, pauseOnAdded, responseCallback);
        };

        $scope.context = {
            currentTab: 'links',
            taskType: 'urls',
            urls: '',
            uploadFile: null,
            availableOptions: (function () {
                var keys = aria2SettingService.getNewTaskOptionKeys();

                return aria2SettingService.getSpecifiedOptions(keys, {
                    disableRequired: true
                });
            })(),
            globalOptions: null,
            options: getRememberedDownloadPathOptions(),
            optionFilter: {
                global: true,
                http: false,
                bittorrent: false
            },
            exportCommandApiOptions: null
        };

        if (parameters.url) {
            try {
                $scope.context.urls = ariaNgCommonService.base64UrlDecode(parameters.url);
            } catch (ex) {
                ariaNgLogService.error('[NewTaskController] base64 decode error, url=' + parameters.url, ex);
            }
        }

        $scope.changeTab = function (tabName) {
            if (tabName === 'options') {
                $scope.loadDefaultOption();
            }

            $scope.context.currentTab = tabName;
        };

        $rootScope.swipeActions.extendLeftSwipe = function () {
            var tabIndex = tabItems.indexOf($scope.context.currentTab);

            if (tabIndex < tabItems.length - 1) {
                $scope.changeTab(tabItems[tabIndex + 1]);
                return true;
            } else {
                return false;
            }
        };

        $rootScope.swipeActions.extendRightSwipe = function () {
            var tabIndex = tabItems.indexOf($scope.context.currentTab);

            if (tabIndex > 0) {
                $scope.changeTab(tabItems[tabIndex - 1]);
                return true;
            } else {
                return false;
            }
        };

        $scope.loadDefaultOption = function () {
            if ($scope.context.globalOptions) {
                return;
            }

            $rootScope.loadPromise = aria2SettingService.getGlobalOption(function (response) {
                if (response.success) {
                    $scope.context.globalOptions = response.data;
                }
            });
        };

        $scope.openTorrent = function () {
            ariaNgFileService.openFileContent({
                scope: $scope,
                fileFilter: '.torrent',
                fileType: 'binary'
            }, function (result) {
                $scope.context.uploadFile = result;
                $scope.context.taskType = 'torrent';
                $scope.changeTab('options');
            }, function (error) {
                ariaNgCommonService.showError(error);
            }, angular.element('#file-holder'));
        };

        $scope.openMetalink = function () {
            ariaNgFileService.openFileContent({
                scope: $scope,
                fileFilter: '.meta4,.metalink',
                fileType: 'binary'
            }, function (result) {
                $scope.context.uploadFile = result;
                $scope.context.taskType = 'metalink';
                $scope.changeTab('options');
            }, function (error) {
                ariaNgCommonService.showError(error);
            }, angular.element('#file-holder'));
        };

        $scope.isNewTaskValid = function () {
            if ($scope.btFileFilterContext && $scope.btFileFilterContext.enabled &&
                !$scope.isBtFileFilterValid()) {
                return false;
            }

            if (!$scope.context.uploadFile) {
                return $scope.newTaskForm.$valid;
            }

            return true;
        };

        $scope.startDownload = function (pauseOnAdded) {
            // 捕获提交瞬间的类型、阈值和启动意图；用户在 RPC 返回前修改表单，不能改变已提交任务的处理方式。
            var requestedPauseOnAdded = !!pauseOnAdded;
            var filterIntent = angular.copy($scope.getBtFileFilterIntent());
            var submissionTaskType = $scope.context.taskType;
            var responseCallback = function (response) {
                if (!response.hasSuccess && !response.success) {
                    return;
                }

                if (filterIntent.enabled) {
                    if (response.results) {
                        for (var i = 0; i < response.results.length; i++) {
                            var result = response.results[i];
                            var resultTask = result.context && result.context.task;

                            if (result.success && result.data && resultTask && resultTask.btFileFilterCandidate) {
                                ariaNgBtFileFilterService.enqueue(result.data, {
                                    thresholdBytes: filterIntent.thresholdBytes,
                                    startAfterFilter: !requestedPauseOnAdded,
                                    sourceType: resultTask.btFileFilterSourceType
                                });
                            }
                        }
                    } else if (submissionTaskType === 'torrent' && response.success && response.data) {
                        ariaNgBtFileFilterService.enqueue(response.data, {
                            thresholdBytes: filterIntent.thresholdBytes,
                            startAfterFilter: !requestedPauseOnAdded,
                            sourceType: 'torrent'
                        });
                    }
                }

                var firstTask = null;

                // 批量结果保留失败项；失败项的 data 是错误对象，不能当作 GID 打开详情页。
                if (response.results && response.results.length > 0) {
                    for (var j = 0; j < response.results.length; j++) {
                        if (response.results[j].success) {
                            firstTask = response.results[j];
                            break;
                        }
                    }
                } else if (response) {
                    firstTask = response;
                }

                if (ariaNgSettingService.getAfterCreatingNewTask() === 'task-detail' && firstTask && firstTask.data) {
                    $location.path('/task/detail/' + firstTask.data);
                } else {
                    if (pauseOnAdded) {
                        $location.path('/waiting');
                    } else {
                        $location.path('/downloading');
                    }
                }
            };

            if (submissionTaskType === 'urls') {
                $rootScope.loadPromise = downloadByLinks(pauseOnAdded, filterIntent, responseCallback);
            } else if (submissionTaskType === 'torrent') {
                $rootScope.loadPromise = downloadByTorrent(filterIntent.enabled ? true : pauseOnAdded, responseCallback);
            } else if (submissionTaskType === 'metalink') {
                $rootScope.loadPromise = downloadByMetalink(pauseOnAdded, responseCallback);
            }
        };

        $scope.showExportCommandAPIModal = function () {
            $scope.context.exportCommandApiOptions = {
                type: 'new-task',
                data: getDownloadTasksByLinks()
            };
        };

        $scope.setOption = function (key, value, optionStatus) {
            if (value !== '' || !aria2SettingService.isOptionKeyRequired(key)) {
                $scope.context.options[key] = value;
            } else {
                delete $scope.context.options[key];
            }

            optionStatus.setReady();
        };

        $scope.urlTextboxKeyDown = function (event) {
            if (!ariaNgSettingService.getKeyboardShortcuts()) {
                return;
            }

            if (ariaNgKeyboardService.isCtrlEnterPressed(event) && $scope.isNewTaskValid()) {
                if (event.preventDefault) {
                    event.preventDefault();
                }

                $scope.startDownload();

                return false;
            }
        };

        $scope.getValidUrlsCount = function () {
            var urls = ariaNgCommonService.parseUrlsFromOriginInput($scope.context.urls);
            return urls ? urls.length : 0;
        };

        $rootScope.loadPromise = $timeout(function () {}, 100);
    }]);
}());
