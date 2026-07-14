'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

const loadRootKeyboardContext = function (searchVisible) {
    let runDefinition;
    let focusCount = 0;
    const module = {
        run: function (definition) {
            runDefinition = definition;
            return module;
        }
    };
    const genericElement = {
        addClass: function () { return genericElement; },
        attr: function () { return ''; },
        click: function () { return genericElement; },
        each: function () { return genericElement; },
        hasClass: function () { return false; },
        is: function () { return false; },
        parent: function () { return genericElement; },
        prepend: function () { return genericElement; },
        removeClass: function () { return genericElement; }
    };
    const angular = {
        module: function () { return module; },
        element: function (selector) {
            if (selector === '#search-box') {
                return {
                    focus: function () { focusCount++; },
                    is: function (query) {
                        assert.strictEqual(query, ':visible');
                        return searchVisible;
                    }
                };
            }
            return genericElement;
        },
        isArray: Array.isArray,
        isFunction: function (value) { return typeof value === 'function'; },
        isObject: function (value) { return value !== null && typeof value === 'object'; },
        isString: function (value) { return typeof value === 'string'; }
    };

    vm.runInNewContext(read('src/scripts/core/root.js'), {angular: angular});

    const rootScope = {
        $on: function () {}
    };
    const noop = function () {};
    const dependencies = {
        '$window': {
            addEventListener: noop,
            location: {reload: noop}
        },
        '$rootScope': rootScope,
        '$location': {path: function () { return '/downloading'; }},
        '$document': {unbind: noop},
        '$timeout': noop,
        'ariaNgCommonService': {closeAllDialogs: noop},
        'ariaNgKeyboardService': {},
        'ariaNgNotificationService': {},
        'ariaNgLogService': {info: noop, warn: noop},
        'ariaNgSettingService': {
            getBrowserFeatures: function () { return {localStroage: true, cookies: true}; },
            getTheme: function () { return 'light'; },
            isBrowserSupportDarkMode: function () { return false; },
            isBrowserSupportStorage: function () { return true; },
            onFirstAccess: noop
        },
        'aria2TaskService': {
            onBtTaskCompleted: noop,
            onConnectionFailed: noop,
            onConnectionReconnecting: noop,
            onConnectionSuccess: noop,
            onConnectionWaitingToReconnect: noop,
            onFirstSuccess: noop,
            onTaskCompleted: noop,
            onTaskErrorOccur: noop
        }
    };
    const names = runDefinition.slice(0, -1);
    const run = runDefinition[runDefinition.length - 1];
    run.apply(null, names.map(function (name) { return dependencies[name]; }));

    return {
        rootScope: rootScope,
        getFocusCount: function () { return focusCount; }
    };
};

const loadConstants = function () {
    const constants = {};
    const module = {
        constant: function (name, value) {
            constants[name] = value;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/config/constants.js'), {
        angular: {
            module: function () {
                return module;
            }
        }
    });

    return constants;
};

const loadSettingService = function (storedOptions) {
    let factoryDefinition;
    let savedOptions = storedOptions;
    const constants = loadConstants();
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };
    const angular = {
        module: function () {
            return module;
        },
        isArray: Array.isArray,
        isDefined: function (value) {
            return typeof value !== 'undefined';
        },
        isUndefined: function (value) {
            return typeof value === 'undefined';
        },
        isFunction: function (value) {
            return typeof value === 'function';
        },
        extend: function (target) {
            for (let i = 1; i < arguments.length; i++) {
                Object.assign(target, arguments[i]);
            }
            return target;
        }
    };

    vm.runInNewContext(read('src/scripts/services/ariaNgSettingService.js'), {
        angular: angular,
        console: console
    });

    const dependencies = {
        '$window': {navigator: {language: 'en'}},
        '$location': {
            protocol: function () { return 'http'; },
            host: function () { return 'localhost'; }
        },
        '$filter': function () {},
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgDefaultOptions': constants.ariaNgDefaultOptions,
        'ariaNgLanguages': {en: {aliases: ['en']}},
        'ariaNgCommonService': {
            base64Decode: function (value) { return value; },
            generateUniqueId: function () { return 'test-id'; }
        },
        'ariaNgLogService': {info: function () {}, warn: function () {}},
        'ariaNgStorageService': {
            isLocalStorageSupported: function () { return true; },
            isCookiesSupported: function () { return false; },
            get: function () { return savedOptions; },
            set: function (key, value) {
                savedOptions = value;
                return true;
            },
            clearAll: function () {}
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        getSavedOptions: function () { return savedOptions; }
    };
};

const loadTaskService = function (changeOption, rpcOverrides) {
    let factoryDefinition;
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/services/aria2TaskService.js'), {
        angular: {
            module: function () {
                return module;
            },
            isDefined: function (value) {
                return typeof value !== 'undefined';
            }
        },
        decodeURI: decodeURI
    });

    const dependencies = {
        '$q': {},
        'bittorrentPeeridService': {},
        'ariaNgConstants': {},
        'aria2Errors': {},
        'aria2RpcService': Object.assign({changeOption: changeOption}, rpcOverrides || {}),
        'ariaNgCommonService': {},
        'ariaNgLocalizationService': {},
        'ariaNgLogService': {},
        'ariaNgSettingService': {}
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];

    return factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));
};

const loadFilterService = function (options) {
    options = options || {};
    let factoryDefinition;
    let savedQueue = options.savedQueue;
    let savedBulkRuns = options.savedBulkRuns;
    let savedBulkProgresses = options.savedBulkProgresses;
    let rpcIdentity = options.rpcIdentity || 'http|localhost|6800|jsonrpc';
    let now = typeof options.now === 'number' ? options.now : 1000;
    const tasks = options.tasks || {};
    const taskOptions = options.taskOptions || {};
    const intervals = [];
    const timeouts = [];
    const changedOptions = [];
    const startedGids = [];
    const pausedGids = [];
    const notifications = [];
    const statusGids = [];
    const storageSets = [];
    const pendingStatusCallbacks = [];
    const pendingOptionCallbacks = [];
    const pendingChangeCallbacks = [];
    const pendingStartCallbacks = [];
    const pendingPauseCallbacks = [];
    const pendingWaitingListCallbacks = [];
    const optionRpcIdentities = [];
    const changeRpcIdentities = [];
    const startRpcIdentities = [];
    const waitingListRequests = [];
    const waitingListResponses = (options.waitingListResponses || []).slice();
    const statusResponses = (options.statusResponses || []).slice();
    const optionResponses = (options.optionResponses || []).slice();
    const changeResponses = (options.changeResponses || []).slice();
    const startResponses = (options.startResponses || []).slice();
    const pauseResponses = (options.pauseResponses || []).slice();
    const constants = loadConstants();
    const module = {
        factory: function (name, definition) {
            factoryDefinition = definition;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/services/ariaNgBtFileFilterService.js'), {
        angular: {
            module: function () {
                return module;
            }
        },
        Date: {now: function () { return now; }}
    });

    const dependencies = {
        '$interval': Object.assign(function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            intervals.push(handle);
            return handle;
        }, {
            cancel: function (handle) {
                handle.cancelled = true;
            }
        }),
        '$timeout': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            timeouts.push(handle);
            return handle;
        },
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgStorageService': {
            get: function (key) {
                if (key === constants.ariaNgConstants.btFileFilterBulkQueueStorageKey) {
                    return savedBulkRuns;
                }
                if (key === constants.ariaNgConstants.btFileFilterBulkProgressStorageKey) {
                    return savedBulkProgresses;
                }
                return savedQueue;
            },
            set: function (key, value) {
                storageSets.push({key: key, size: JSON.stringify(value).length});
                const setResult = typeof options.storageSetResult === 'function' ?
                    options.storageSetResult(key, value, storageSets.length) : options.storageSetResult;
                if (setResult === false) {
                    return false;
                }
                if (key === constants.ariaNgConstants.btFileFilterBulkQueueStorageKey) {
                    savedBulkRuns = value;
                } else if (key === constants.ariaNgConstants.btFileFilterBulkProgressStorageKey) {
                    savedBulkProgresses = value;
                } else {
                    assert.strictEqual(key, constants.ariaNgConstants.btFileFilterQueueStorageKey);
                    savedQueue = value;
                }
                return true;
            }
        },
        'ariaNgSettingService': {
            getCurrentRpcIdentity: function () { return rpcIdentity; }
        },
        'ariaNgNotificationService': {
            notifyInPage: function (title, content, notificationOptions) {
                notifications.push({title: title, content: content, options: notificationOptions});
            }
        },
        'ariaNgLogService': {warn: function () {}},
        'aria2TaskService': {
            getTaskStatus: function (gid, callback) {
                statusGids.push(gid);
                if (options.deferStatus) {
                    pendingStatusCallbacks.push({gid: gid, callback: callback});
                    return;
                }
                if (options.statusResponseForGid) {
                    callback(options.statusResponseForGid(gid));
                } else if (statusResponses.length > 0) {
                    callback(statusResponses.shift());
                } else if (tasks[gid]) {
                    callback({success: true, data: tasks[gid]});
                } else {
                    callback({success: false, data: {message: 'GID ' + gid + ' is not found'}});
                }
            },
            getTaskOptions: function (gid, callback) {
                optionRpcIdentities.push(rpcIdentity);
                const response = optionResponses.length > 0 ? optionResponses.shift() : {
                    success: true,
                    data: taskOptions[gid] || taskOptions
                };
                if (options.deferOptions) {
                    pendingOptionCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            getTaskList: function (type, full, callback, silent, requestParams) {
                waitingListRequests.push({
                    type: type,
                    full: full,
                    silent: silent,
                    requestParams: requestParams
                });
                let sourceTasks = options.waitingTasks || [];
                if (type === 'downloading') {
                    sourceTasks = options.activeTasks || [];
                }
                const response = waitingListResponses.length > 0 ? waitingListResponses.shift() :
                    {success: true, data: sourceTasks};
                if (options.deferWaitingList) {
                    pendingWaitingListCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            changeTaskOptions: function (gid, rpcOptions, callback) {
                changeRpcIdentities.push(rpcIdentity);
                changedOptions.push({gid: gid, options: Object.assign({}, rpcOptions)});
                const response = changeResponses.length > 0 ? changeResponses.shift() : {success: true, data: 'OK'};
                const callNumber = changedOptions.length;
                const applyFailedChange = typeof options.applyFailedChanges === 'function' ?
                    options.applyFailedChanges(callNumber, rpcOptions) : options.applyFailedChanges;
                const applySuccessfulChange = response.success && options.applySuccessfulChanges !== false;
                if ((applySuccessfulChange || applyFailedChange) && tasks[gid] && rpcOptions['select-file']) {
                    const selected = rpcOptions['select-file'].split(',');
                    tasks[gid].files.forEach(function (file) {
                        file.selected = selected.indexOf(String(file.index)) >= 0 ? 'true' : 'false';
                    });
                    const targetOptions = taskOptions[gid] || taskOptions;
                    Object.assign(targetOptions, rpcOptions);
                    if (options.normalizedSelectFile && rpcOptions['select-file']) {
                        targetOptions['select-file'] = options.normalizedSelectFile;
                    }
                }
                if (options.deferChange) {
                    pendingChangeCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            startTasks: function (gids, callback) {
                startRpcIdentities.push(rpcIdentity);
                startedGids.push.apply(startedGids, gids);
                const response = startResponses.length > 0 ? startResponses.shift() : {success: true, data: 'OK'};
                if ((response.success || response.hasSuccess) && options.applySuccessfulStart !== false) {
                    gids.forEach(function (gid) {
                        if (tasks[gid]) {
                            tasks[gid].status = 'active';
                        }
                    });
                }
                if (options.deferStart) {
                    pendingStartCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            },
            pauseTasks: function (gids, callback) {
                pausedGids.push.apply(pausedGids, gids);
                const response = pauseResponses.length > 0 ? pauseResponses.shift() : {success: true, data: 'OK'};
                if ((response.success || response.hasSuccess) && options.applySuccessfulPause !== false) {
                    gids.forEach(function (gid) {
                        if (tasks[gid]) {
                            tasks[gid].status = 'paused';
                        }
                    });
                }
                if (options.deferPause) {
                    pendingPauseCallbacks.push({callback: callback, response: response});
                } else {
                    callback(response);
                }
            }
        }
    };
    const names = factoryDefinition.slice(0, -1);
    const factory = factoryDefinition[factoryDefinition.length - 1];
    const service = factory.apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        service: service,
        changedOptions: changedOptions,
        startedGids: startedGids,
        pausedGids: pausedGids,
        notifications: notifications,
        statusGids: statusGids,
        storageSets: storageSets,
        optionRpcIdentities: optionRpcIdentities,
        changeRpcIdentities: changeRpcIdentities,
        startRpcIdentities: startRpcIdentities,
        waitingListRequests: waitingListRequests,
        intervals: intervals,
        timeouts: timeouts,
        setRpcIdentity: function (value) { rpcIdentity = value; },
        setNow: function (value) { now = value; },
        advanceNow: function (milliseconds) { now += milliseconds; },
        resolveStatus: function (response) {
            const pending = pendingStatusCallbacks.shift();
            pending.callback(response || {success: true, data: tasks[pending.gid]});
        },
        resolveOptions: function (response) {
            const pending = pendingOptionCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolveChange: function (response) {
            const pending = pendingChangeCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolveStart: function (response) {
            const pending = pendingStartCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolvePause: function (response) {
            const pending = pendingPauseCallbacks.shift();
            pending.callback(response || pending.response);
        },
        resolveWaitingList: function (response) {
            const pending = pendingWaitingListCallbacks.shift();
            pending.callback(response || pending.response);
        },
        getSavedQueue: function () { return savedQueue || []; },
        getSavedBulkRuns: function () { return savedBulkRuns || []; },
        getSavedBulkProgresses: function () { return savedBulkProgresses || []; },
        tick: function () {
            intervals.forEach(function (interval) {
                if (!interval.cancelled) {
                    interval.callback();
                }
            });
        },
        tickMany: function (count) {
            for (let i = 0; i < count; i++) {
                intervals.forEach(function (interval) {
                    if (!interval.cancelled) {
                        interval.callback();
                    }
                });
            }
        },
        tickUntilIdle: function () {
            for (let i = 0; i < 30 && service.getJobs().some(function (job) {
                return job.rpcIdentity === rpcIdentity;
            }); i++) {
                intervals.forEach(function (interval) {
                    if (!interval.cancelled) {
                        interval.callback();
                    }
                });
            }
        }
    };
};

const angularStub = {
    module: function () {},
    isDefined: function (value) { return typeof value !== 'undefined'; },
    copy: function (value) {
        return JSON.parse(JSON.stringify(value));
    },
    element: function () { return {}; }
};

const loadNewTaskController = function (options) {
    options = options || {};
    let controllerDefinition;
    const uriTasks = [];
    const torrentCalls = [];
    const metalinkCalls = [];
    const enqueued = [];
    const paths = [];
    const savedDownloadPaths = [];
    let torrentCallback;
    let metalinkCallback;
    const module = {
        controller: function (name, definition) {
            controllerDefinition = definition;
            return module;
        }
    };
    const angular = Object.assign({}, angularStub, {
        module: function () { return module; }
    });

    vm.runInNewContext(read('src/scripts/controllers/new.js'), {angular: angular});

    const scope = {
        getBtFileFilterIntent: function () {
            return options.filterIntent || {enabled: false, thresholdBytes: 104857600};
        },
        btFileFilterContext: options.btFileFilterContext,
        isBtFileFilterValid: options.isBtFileFilterValid || function () { return true; },
        newTaskForm: {$valid: true}
    };
    const rootScope = {swipeActions: {}};
    const filterService = {
        isBtMetadataUrl: function (url) {
            return /^magnet:/i.test(url) || /\.torrent(?:$|[?#])/i.test(url);
        },
        enqueue: function (gid, intent) {
            enqueued.push({gid: gid, intent: intent});
        }
    };
    const taskService = {
        newUriTasks: function (tasks, pauseOnAdded, callback) {
            tasks.forEach(function (task) { uriTasks.push(task); });
            if (options.uriResponse) {
                callback(options.uriResponse(tasks));
            }
            return 'uri-promise';
        },
        newTorrentTask: function (task, pauseOnAdded, callback) {
            torrentCalls.push({task: task, pauseOnAdded: pauseOnAdded});
            torrentCallback = callback;
            if (options.torrentResponse) {
                callback(options.torrentResponse);
            }
            return 'torrent-promise';
        },
        newMetalinkTask: function (task, pauseOnAdded, callback) {
            metalinkCalls.push({task: task, pauseOnAdded: pauseOnAdded});
            metalinkCallback = callback;
            return 'metalink-promise';
        }
    };
    const dependencies = {
        '$rootScope': rootScope,
        '$scope': scope,
        '$location': {
            search: function () { return {}; },
            path: function (value) { if (value) { paths.push(value); } return paths[paths.length - 1] || '/new'; }
        },
        '$timeout': function () {},
        'ariaNgCommonService': {
            parseUrlsFromOriginInput: function (value) { return value.split(/\r?\n/); },
            showError: function () {}
        },
        'ariaNgLogService': {error: function () {}},
        'ariaNgKeyboardService': {
            isCtrlEnterPressed: function () { return true; }
        },
        'ariaNgFileService': {},
        'ariaNgSettingService': {
            getAfterCreatingNewTask: function () { return 'task-list'; },
            getKeyboardShortcuts: function () { return !!options.keyboardShortcuts; },
            getCurrentRpcIdentity: function () { return options.rpcIdentity || 'http|localhost|6800|jsonrpc'; }
        },
        'ariaNgBtFileFilterService': filterService,
        'aria2TaskService': taskService,
        'aria2SettingService': {
            getNewTaskOptionKeys: function () { return []; },
            getSpecifiedOptions: function () { return {}; },
            getSettingHistory: function (key, scope) {
                if (key === 'dir' && scope === (options.rpcIdentity || 'http|localhost|6800|jsonrpc')) {
                    return options.downloadPathHistory || [];
                }

                if (key === 'dir' && !scope) {
                    return options.legacyDownloadPathHistory || [];
                }

                return [];
            },
            addSettingHistory: function (key, value, scope) {
                savedDownloadPaths.push({key: key, value: value, scope: scope});
            }
        }
    };
    const names = controllerDefinition.slice(0, -1);
    controllerDefinition[controllerDefinition.length - 1].apply(null, names.map(function (name) {
        return dependencies[name];
    }));
    scope.context.urls = options.urls || '';
    if (options.taskOptions) {
        scope.context.options = options.taskOptions;
    }
    if (options.taskType) {
        scope.context.taskType = options.taskType;
        scope.context.uploadFile = {base64Content: 'torrent-content'};
    }

    return {
        scope: scope,
        uriTasks: uriTasks,
        torrentCalls: torrentCalls,
        metalinkCalls: metalinkCalls,
        enqueued: enqueued,
        paths: paths,
        savedDownloadPaths: savedDownloadPaths,
        respondTorrent: function (response) { torrentCallback(response); },
        respondMetalink: function (response) { metalinkCallback(response); }
    };
};

const loadMainController = function (options) {
    options = options || {};
    let controllerDefinition;
    let globalStatCallback;
    let startCount = 0;
    let stopCount = 0;
    const broadcasts = [];
    const status = {visible: false};
    const bulkStatus = {visible: false, type: 'idle'};
    const module = {
        controller: function (name, definition) {
            controllerDefinition = definition;
            return module;
        }
    };

    vm.runInNewContext(read('src/scripts/controllers/main.js'), {
        angular: {module: function () { return module; }}
    });

    const scope = {$on: function () {}};
    const rootScope = {
        taskContext: {getSelectedTaskIds: function () { return []; }},
        $broadcast: function (name) { broadcasts.push(name); }
    };
    const noop = function () {};
    const settingDefaults = {
        getBrowserNotification: function () { return false; },
        getGlobalStatRefreshInterval: function () { return 0; },
        getTitleRefreshInterval: function () { return 0; },
        getAllRpcSettings: function () { return []; },
        isCurrentRpcUseWebSocket: function () { return false; },
        getBtFileFilterEnabled: function () { return true; },
        getBtFileFilterMinSizeMb: function () { return 100; }
    };
    const settingService = new Proxy(settingDefaults, {
        get: function (target, property) { return target[property] || noop; }
    });
    const dependencies = {
        '$rootScope': rootScope,
        '$scope': scope,
        '$route': {reload: noop},
        '$window': {location: {reload: noop}},
        '$location': {path: function () { return options.path || '/new'; }},
        '$document': [{title: ''}],
        '$interval': Object.assign(function () {}, {cancel: noop}),
        'clipboard': {},
        'aria2RpcErrors': {Unauthorized: {message: 'Unauthorized'}},
        'ariaNgCommonService': {},
        'ariaNgVersionService': {getBuildVersion: function () { return 'test'; }},
        'ariaNgNotificationService': {},
        'ariaNgSettingService': settingService,
        'ariaNgMonitorService': {getGlobalStatsData: function () { return []; }, recordGlobalStat: noop},
        'ariaNgTitleService': {getFinalTitleByGlobalStat: function () { return 'title'; }},
        'ariaNgBtFileFilterService': {
            getStatus: function () { return status; },
            getBulkStatus: function () { return bulkStatus; },
            start: function () { startCount++; },
            stop: function () { stopCount++; }
        },
        'aria2TaskService': {},
        'aria2SettingService': {
            getGlobalStat: function (callback) { globalStatCallback = callback; return 'global-stat-promise'; }
        }
    };
    const names = controllerDefinition.slice(0, -1);
    controllerDefinition[controllerDefinition.length - 1].apply(null, names.map(function (name) {
        return dependencies[name];
    }));

    return {
        scope: scope,
        status: status,
        bulkStatus: bulkStatus,
        respondGlobalStat: function (response) { globalStatCallback(response); },
        getStartCount: function () { return startCount; },
        getStopCount: function () { return stopCount; },
        broadcasts: broadcasts
    };
};

test('adds magnets for metadata discovery while preserving Download Later for ordinary URLs', function () {
    const context = loadNewTaskController({
        urls: 'magnet:?xt=urn:btih:abc\nhttps://host/file.iso',
        filterIntent: {enabled: true, thresholdBytes: 104857600}
    });

    context.scope.startDownload(true);

    assert.strictEqual(context.uriTasks[0].options['pause-metadata'], 'true');
    assert.strictEqual(context.uriTasks[0].pauseOnAdded, false);
    assert.strictEqual(context.uriTasks[0].btFileFilterCandidate, true);
    assert.strictEqual(context.uriTasks[1].pauseOnAdded, true);
    assert.strictEqual(context.uriTasks[1].options['pause-metadata'], undefined);
});

test('restores and updates the last download path for the current RPC', function () {
    const rpcIdentity = 'https|downloads.example|443|jsonrpc';
    const context = loadNewTaskController({
        urls: 'https://host/file.iso',
        rpcIdentity: rpcIdentity,
        downloadPathHistory: ['/downloads/movies']
    });

    assert.strictEqual(context.scope.context.options.dir, '/downloads/movies');

    context.scope.startDownload(false);

    assert.strictEqual(context.uriTasks[0].options.dir, '/downloads/movies');
    assert.deepStrictEqual(context.savedDownloadPaths, [{
        key: 'dir',
        value: '/downloads/movies',
        scope: undefined
    }, {
        key: 'dir',
        value: '/downloads/movies',
        scope: rpcIdentity
    }]);
});

test('falls back to the existing unscoped download path history after upgrade', function () {
    const context = loadNewTaskController({
        legacyDownloadPathHistory: ['/downloads/legacy']
    });

    assert.strictEqual(context.scope.context.options.dir, '/downloads/legacy');
});

test('binds remembered new-task options into their visible inputs', function () {
    const newTaskView = read('src/views/new.html');
    const newTaskStyles = read('src/styles/controls/new-task-table.css');
    const settingDirective = read('src/scripts/directives/setting.js');

    assert(newTaskView.includes('model-value="context.options[option.key]"'));
    assert(!newTaskView.includes('ng-model="context.options[option.key]"'));
    assert(newTaskView.includes('class="new-task-download-path"'));
    assert(newTaskView.includes('ng-model="context.options.dir"'));
    assert(newTaskView.includes("ng-bind=\"'options.dir.name' | translate\""));
    assert(newTaskStyles.includes('.new-task-download-path'));
    assert(newTaskStyles.includes('@media (max-width: 991px)'));
    assert(settingDirective.includes("scope.$watch('modelValue', syncExternalValue)"));
    assert(settingDirective.includes("scope.$watch('ngModel', syncExternalValue)"));
    assert(settingDirective.includes('externalValueInitialized'));
    assert(settingDirective.includes('scope.optionValue = undefined;'));
    assert(settingDirective.includes('scope.optionValue = displayValue;'));
    assert(!settingDirective.includes('return ngModel.$viewValue;'));
});

test('enqueues only successful URI metadata candidates with the snapshotted intent', function () {
    const intent = {enabled: true, thresholdBytes: 209715200};
    const context = loadNewTaskController({
        urls: 'magnet:?xt=urn:btih:abc\nhttps://host/file.iso\nhttps://host/file.torrent\nhttps://host/failed.torrent',
        filterIntent: intent,
        uriResponse: function (tasks) {
            intent.thresholdBytes = 1;
            return {hasSuccess: true, results: [
                {success: true, data: 'magnet-gid', context: {task: tasks[0]}},
                {success: true, data: 'direct-gid', context: {task: tasks[1]}},
                {success: true, data: 'torrent-gid', context: {task: tasks[2]}},
                {success: false, data: {message: 'failed'}, context: {task: tasks[3]}}
            ]};
        }
    });

    context.scope.startDownload(false);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.enqueued)), [{gid: 'magnet-gid', intent: {
        thresholdBytes: 209715200,
        startAfterFilter: true,
        sourceType: 'magnet'
    }}, {gid: 'torrent-gid', intent: {
        thresholdBytes: 209715200,
        startAfterFilter: true,
        sourceType: 'remote-torrent'
    }}]);
});

test('forces local torrents paused while filtering and enqueues the returned GID', function () {
    const context = loadNewTaskController({
        taskType: 'torrent',
        filterIntent: {enabled: true, thresholdBytes: 104857600},
        torrentResponse: {success: true, data: 'torrent-gid'}
    });

    context.scope.startDownload(false);

    assert.strictEqual(context.torrentCalls[0].pauseOnAdded, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.enqueued)), [{gid: 'torrent-gid', intent: {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'torrent'
    }}]);
});

test('enqueues a delayed local torrent response after the form switches to Metalink', function () {
    const context = loadNewTaskController({
        taskType: 'torrent',
        filterIntent: {enabled: true, thresholdBytes: 104857600}
    });

    context.scope.startDownload(false);
    context.scope.context.taskType = 'metalink';
    context.respondTorrent({success: true, data: 'torrent-gid'});

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.enqueued)), [{gid: 'torrent-gid', intent: {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'torrent'
    }}]);
});

test('never enqueues a delayed Metalink response after the form switches to torrent', function () {
    const context = loadNewTaskController({
        taskType: 'metalink',
        filterIntent: {enabled: true, thresholdBytes: 104857600}
    });

    context.scope.startDownload(false);
    context.scope.context.taskType = 'torrent';
    context.respondMetalink({success: true, data: 'metalink-gid'});

    assert.deepStrictEqual(context.enqueued, []);
});

test('leaves disabled URI, torrent, and Metalink submissions unchanged', function () {
    const urls = loadNewTaskController({urls: 'magnet:?xt=urn:btih:abc', filterIntent: {enabled: false}});
    urls.scope.startDownload(true);
    assert.strictEqual(urls.uriTasks[0].pauseOnAdded, true);
    assert.strictEqual(urls.uriTasks[0].options['pause-metadata'], undefined);
    assert.deepStrictEqual(urls.enqueued, []);

    const torrent = loadNewTaskController({taskType: 'torrent', filterIntent: {enabled: false}});
    torrent.scope.startDownload(false);
    assert.strictEqual(torrent.torrentCalls[0].pauseOnAdded, false);
    assert.deepStrictEqual(torrent.enqueued, []);

    const metalink = loadNewTaskController({taskType: 'metalink', filterIntent: {enabled: true}});
    metalink.scope.startDownload(true);
    assert.strictEqual(metalink.metalinkCalls[0].pauseOnAdded, true);
    assert.deepStrictEqual(metalink.enqueued, []);
});

test('rejects a new task when the enabled header filter threshold is invalid', function () {
    const context = loadNewTaskController({
        btFileFilterContext: {enabled: true, minSizeMb: 'bad'},
        isBtFileFilterValid: function () { return false; }
    });

    assert.strictEqual(context.scope.isNewTaskValid(), false);
});

test('does not submit an invalid enabled filter with Ctrl+Enter', function () {
    const context = loadNewTaskController({
        urls: 'https://host/file.iso',
        keyboardShortcuts: true,
        btFileFilterContext: {enabled: true, minSizeMb: 'bad'},
        isBtFileFilterValid: function () { return false; }
    });

    context.scope.urlTextboxKeyDown({preventDefault: function () {}});

    assert.strictEqual(context.uriTasks.length, 0);
});

test('MainController exposes stable filter status and starts after successful global stat', function () {
    const context = loadMainController();

    assert.strictEqual(context.scope.btFileFilterStatus, context.status);
    context.status.visible = true;
    assert.strictEqual(context.scope.showAutomaticBtFileFilterStatus(), true);
    context.bulkStatus.visible = true;
    assert.strictEqual(context.scope.showAutomaticBtFileFilterStatus(), false);
    assert.strictEqual(context.scope.isNewTaskPage(), true);
    assert.strictEqual(context.getStartCount(), 0);
    context.respondGlobalStat({success: false, data: {message: 'offline'}});
    assert.strictEqual(context.getStartCount(), 0);
    context.respondGlobalStat({success: true, data: {downloadSpeed: '0'}});
    assert.strictEqual(context.getStartCount(), 1);
    context.respondGlobalStat({success: true, data: {downloadSpeed: '0'}});
    assert.strictEqual(context.getStartCount(), 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.scope.getBtFileFilterIntent())), {
        enabled: true,
        thresholdBytes: 104857600
    });
    context.respondGlobalStat({success: false, data: {message: 'Unauthorized'}});
    assert.strictEqual(context.getStopCount(), 1);
    assert.deepStrictEqual(context.broadcasts, ['bt-file-filter.stopped']);
});

test('defines safe small-file filter defaults and queue storage key', function () {
    const constants = loadConstants();

    assert.strictEqual(constants.ariaNgConstants.btFileFilterQueueStorageKey, 'BtFileFilterQueue');
    assert.strictEqual(constants.ariaNgDefaultOptions.btFileFilterEnabled, false);
    assert.strictEqual(constants.ariaNgDefaultOptions.btFileFilterMinSizeMb, 100);
});

test('persists enabled state and a valid integer threshold', function () {
    const context = loadSettingService({language: 'en'});

    context.service.setBtFileFilterEnabled(true);
    context.service.setBtFileFilterMinSizeMb(256);

    assert.strictEqual(context.service.getBtFileFilterEnabled(), true);
    assert.strictEqual(context.service.getBtFileFilterMinSizeMb(), 256);
    assert.strictEqual(context.getSavedOptions().btFileFilterMinSizeMb, 256);
});

test('rejects invalid thresholds without replacing the saved value', function () {
    const context = loadSettingService({language: 'en', btFileFilterMinSizeMb: 100});

    [0, 1.5, 102401, 'abc'].forEach(function (value) {
        context.service.setBtFileFilterMinSizeMb(value);
        assert.strictEqual(context.service.getBtFileFilterMinSizeMb(), 100);
    });
});

test('builds an RPC identity without storing alias or secret', function () {
    const context = loadSettingService({
        language: 'en', protocol: 'https', rpcHost: 'aria2.local', rpcPort: '6800',
        rpcInterface: 'jsonrpc', rpcAlias: 'private', secret: 'encoded-secret'
    });

    assert.strictEqual(context.service.getCurrentRpcIdentity(), 'https|aria2.local|6800|jsonrpc');
});

test('supports atomic task options and per-task pause overrides', function () {
    const rpcSource = read('src/scripts/services/aria2RpcService.js');
    const taskSource = read('src/scripts/services/aria2TaskService.js');

    assert(rpcSource.includes('angular.isDefined(task.pauseOnAdded)'));
    assert(taskSource.includes('changeTaskOptions: function (gid, options, callback, silent)'));
    assert(taskSource.includes('options: options'));
});

test('sends multiple task options in one RPC call', function () {
    let lastChangeOption;
    const callback = function () {};
    const rpcResult = {};
    const service = loadTaskService(function (context) {
        lastChangeOption = {
            gid: context.gid,
            options: Object.assign({}, context.options),
            silent: context.silent,
            callback: context.callback
        };
        return rpcResult;
    });

    const result = service.changeTaskOptions('gid-1', {
        'select-file': '2,4',
        'bt-remove-unselected-file': 'true'
    }, callback, true);

    assert.deepStrictEqual(lastChangeOption.options, {
        'select-file': '2,4',
        'bt-remove-unselected-file': 'true'
    });
    assert.strictEqual(lastChangeOption.gid, 'gid-1');
    assert.strictEqual(lastChangeOption.silent, true);
    assert.strictEqual(lastChangeOption.callback, callback);
    assert.strictEqual(result, rpcResult);
});

test('requests metadata relationship fields only for targeted waiting-list discovery', function () {
    let tellWaitingContext;
    const service = loadTaskService(function () {}, {
        getFullTaskParams: function () { return ['default-full']; },
        getBasicTaskParams: function () { return ['default-basic']; },
        tellWaiting: function (context) {
            tellWaitingContext = context;
            return 'waiting-promise';
        }
    });
    const requestParams = ['gid', 'following'];
    const callback = function () {};

    const result = service.getTaskList('waiting', true, callback, true, requestParams);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(tellWaitingContext.requestParams)), requestParams);
    assert.strictEqual(tellWaitingContext.silent, true);
    assert.strictEqual(result, 'waiting-promise');
});

test('recognizes supported BT metadata inputs only', function () {
    const service = loadFilterService().service;

    assert.strictEqual(service.isBtMetadataUrl('magnet:?xt=urn:btih:abc'), true);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.torrent?token=1'), true);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso'), false);
    assert.strictEqual(service.isBtMetadataUrl('ftp://host/file.torrent'), false);
});

test('requires the HTTP URL path to end in torrent', function () {
    const service = loadFilterService().service;

    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso?next=.torrent?token=1'), false);
    assert.strictEqual(service.isBtMetadataUrl('https://host/file.iso#fake.torrent'), false);
});

test('filters only mixed-size file lists with strict threshold semantics', function () {
    const service = loadFilterService().service;
    const mb = 1024 * 1024;

    assert.deepStrictEqual(JSON.parse(JSON.stringify(service.planFiles([
        {index: '1', length: String(99 * mb)},
        {index: '2', length: String(100 * mb)},
        {index: '3', length: String(101 * mb)}
    ], 100 * mb))), {
        mode: 'filter', selectedIndexes: [2, 3], allIndexes: [1, 2, 3]
    });
    assert.strictEqual(service.planFiles([{index: '1', length: '1'}], 100 * mb).mode, 'all-small');
    assert.strictEqual(service.planFiles([{index: '1', length: String(101 * mb)}], 100 * mb).mode, 'all-large');
});

test('persists immutable jobs under the current RPC identity', function () {
    const context = loadFilterService({rpcIdentity: 'http|one|6800|jsonrpc'});
    const intent = {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'magnet'
    };

    context.service.enqueue('root-1', intent);
    intent.thresholdBytes = 1;

    const saved = context.getSavedQueue();
    assert.strictEqual(saved[0].rpcIdentity, 'http|one|6800|jsonrpc');
    assert.strictEqual(saved[0].rootGid, 'root-1');
    assert.strictEqual(saved[0].thresholdBytes, 104857600);
    assert.strictEqual(saved[0].stage, 'waiting-metadata');
});

test('rejects duplicate jobs and exposes a stable idle status object', function () {
    const context = loadFilterService();

    context.service.enqueue('root-1', {
        thresholdBytes: 104857600,
        startAfterFilter: false,
        sourceType: 'torrent'
    });
    context.service.enqueue('root-1', {
        thresholdBytes: 1,
        startAfterFilter: true,
        sourceType: 'magnet'
    });

    assert.strictEqual(context.service.getJobs().length, 1);
    assert.strictEqual(context.service.getStatus(), context.service.getStatus());
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.service.getStatus())), {
        visible: false,
        type: 'idle',
        total: 0,
        processed: 0,
        waiting: 0,
        filtered: 0,
        full: 0,
        fallback: 0,
        textKey: '',
        textParams: {}
    });
    context.service.start();
    assert.strictEqual(context.intervals.length, 1);
});

test('follows metadata child, filters mixed files, enables cleanup, and starts Download Now', function () {
    const context = loadFilterService({
        tasks: {
            root: {gid: 'root', status: 'complete', followedBy: ['child'], bittorrent: {}, files: [
                {index: '1', path: '[METADATA]hash', length: '17717', selected: 'true'}
            ]},
            child: {gid: 'child', status: 'paused', bittorrent: {mode: 'multi'}, files: [
                {index: '1', length: '1048576', selected: 'true'},
                {index: '2', length: '209715200', selected: 'true'}
            ]}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.deepStrictEqual(context.startedGids, ['child']);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('does not mistake an active magnet metadata file for the final BT task', function () {
    const context = loadFilterService({tasks: {
        root: {gid: 'root', status: 'active', bittorrent: {}, files: [
            {index: '1', path: '[METADATA]hash', length: '0', selected: 'true'}
        ]}
    }});

    context.service.enqueue('root', {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'magnet'
    });
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 0);
    assert.strictEqual(context.service.getStatus().full, 0);
});

test('Download Later pauses a recovered active magnet child before filtering', function () {
    const context = loadFilterService({
        tasks: {
            child: {gid: 'child', status: 'active', following: 'root', bittorrent: {mode: 'multi'}, files: [
                {index: '1', length: '1048576', selected: 'true'},
                {index: '2', length: '209715200', selected: 'true'}
            ]}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'},
        waitingTasks: [],
        activeTasks: [{gid: 'child', following: 'root'}]
    });

    context.service.enqueue('root', {thresholdBytes: 104857600, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    context.tick();
    context.tick();

    assert.deepStrictEqual(context.pausedGids, ['child']);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);

    context.tick();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().full, 0);
});

test('Download Later pauses a waiting BT child before filtering', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'waiting', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.pausedGids, ['task']);
    assert.deepStrictEqual(context.changedOptions, []);

    context.tick();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'task',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.deepStrictEqual(context.startedGids, []);
});

test('immediate download filters a recovered active magnet child without unpausing it', function () {
    const context = loadFilterService({
        tasks: {
            child: {gid: 'child', status: 'active', following: 'root', bittorrent: {mode: 'multi'}, files: [
                {index: '1', length: '1048576', selected: 'true'},
                {index: '2', length: '209715200', selected: 'true'}
            ]}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'},
        waitingTasks: [],
        activeTasks: [{gid: 'child', following: 'root'}]
    });

    context.service.enqueue('root', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.deepStrictEqual(context.pausedGids, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 1);
});

test('silently removes a job when aggregate unpause reports a nested missing GID', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        startResponses: [{
            hasSuccess: false,
            hasError: true,
            results: [{
                success: false,
                data: {message: 'No such download for GID#task'}
            }]
        }]
    });

    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
    assert.strictEqual(context.service.getStatus().type, 'idle');
    assert.strictEqual(context.service.getStatus().filtered, 0);
    assert.strictEqual(context.service.getStatus().full, 0);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('aggregate unpause success wins over an unrelated nested missing GID', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        startResponses: [{
            hasSuccess: true,
            hasError: true,
            results: [
                {success: true, data: 'OK'},
                {success: false, data: {message: 'No such download for GID#unrelated'}}
            ]
        }]
    });

    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('recovers five paused magnet children when aria2 no longer retains metadata results', function () {
    const waitingTasks = [];
    const startResponses = [];
    const tasks = {};

    for (let i = 1; i <= 5; i++) {
        const child = {
            gid: 'child-' + i,
            following: 'root-' + i,
            status: 'paused',
            bittorrent: {mode: 'multi'},
            files: [
                {index: '1', length: '1048576', selected: 'true'},
                {index: '2', length: '209715200', selected: 'true'}
            ]
        };
        waitingTasks.push(child);
        tasks[child.gid] = child;
        startResponses.push({
            hasSuccess: true,
            hasError: false,
            results: [{success: true, data: 'OK'}]
        });
    }

    const context = loadFilterService({
        waitingTasks: waitingTasks,
        tasks: tasks,
        statusResponseForGid: function (gid) {
            return tasks[gid] ? {success: true, data: tasks[gid]} : {
                success: false,
                data: {message: 'No such download for GID#' + gid}
            };
        },
        startResponses: startResponses,
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    for (let i = 1; i <= 5; i++) {
        context.service.enqueue('root-' + i, {
            thresholdBytes: 104857600,
            startAfterFilter: true,
            sourceType: 'magnet'
        });
    }
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.waitingListRequests.length, 1);
    assert(context.waitingListRequests.every(function (request) {
        return request.type === 'waiting' && request.full === true && request.silent === true &&
            JSON.stringify(request.requestParams) ===
                JSON.stringify(['gid', 'following', 'infoHash']);
    }));
    assert.deepStrictEqual(context.changedOptions.map(function (change) {
        return change.gid;
    }).sort(), ['child-1', 'child-2', 'child-3', 'child-4', 'child-5']);
    assert.deepStrictEqual(context.startedGids.slice().sort(),
        ['child-1', 'child-2', 'child-3', 'child-4', 'child-5']);
    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().filtered, 5);
});

test('recovers an already-registered active BT task by its unique InfoHash', function () {
    const activeTask = {
        gid: 'existing', status: 'active',
        infoHash: '0123456789ABCDEF0123456789ABCDEF01234567', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        tasks: {
            root: {
                gid: 'root', status: 'error', errorCode: '12',
                errorMessage: 'InfoHash 0123456789abcdef0123456789abcdef01234567 is already registered.',
                infoHash: '0123456789abcdef0123456789abcdef01234567', bittorrent: {}, files: []
            },
            existing: activeTask
        },
        activeTasks: [activeTask],
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{gid: 'existing', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'true'
    }}]);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('InfoHash recovery never reselects files excluded from an existing BT task', function () {
    const infoHash = '0123456789abcdef0123456789abcdef01234567';
    const activeTask = {
        gid: 'existing', status: 'active', infoHash: infoHash, bittorrent: {}, files: [
            {index: '1', length: '50', selected: 'false'},
            {index: '2', length: '200', selected: 'false'},
            {index: '3', length: '600', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        tasks: {
            root: {
                gid: 'root', status: 'error', errorCode: '12', infoHash: infoHash,
                bittorrent: {}, files: []
            },
            existing: activeTask
        },
        activeTasks: [activeTask],
        taskOptions: {'bt-remove-unselected-file': 'true'}
    });

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(activeTask.files.map(function (file) { return file.selected; }),
        ['false', 'false', 'true']);
    assert.strictEqual(context.service.getStatus().full, 1);
});

test('InfoHash recovery leaves an all-small partial selection unchanged', function () {
    const infoHash = '0123456789abcdef0123456789abcdef01234567';
    const activeTask = {
        gid: 'existing', status: 'active', infoHash: infoHash, bittorrent: {}, files: [
            {index: '1', length: '10', selected: 'false'},
            {index: '2', length: '20', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        tasks: {
            root: {gid: 'root', status: 'error', errorCode: '12', infoHash: infoHash,
                bittorrent: {}, files: []},
            existing: activeTask
        },
        activeTasks: [activeTask],
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(activeTask.files.map(function (file) { return file.selected; }), ['false', 'true']);
});

test('Download Later InfoHash recovery never pauses a pre-existing active task', function () {
    const infoHash = '0123456789abcdef0123456789abcdef01234567';
    const activeTask = {
        gid: 'existing', status: 'active', infoHash: infoHash, bittorrent: {}, files: [
            {index: '1', length: '20', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        tasks: {
            root: {gid: 'root', status: 'error', errorCode: '12', infoHash: infoHash,
                bittorrent: {}, files: []},
            existing: activeTask
        },
        activeTasks: [activeTask],
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'
    });
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.pausedGids, []);
    assert.strictEqual(activeTask.status, 'active');
    assert.deepStrictEqual(context.changedOptions, [{gid: 'existing', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'true'
    }}]);
});

test('coalesces an InfoHash recovery already owned by another filter job', function () {
    const infoHash = '0123456789abcdef0123456789abcdef01234567';
    const baseJob = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', thresholdBytes: 100,
        startAfterFilter: true, sourceType: 'magnet', retryCount: 0,
        originalRemoveUnselectedFile: null
    };
    const activeTask = {
        gid: 'existing', status: 'active', infoHash: infoHash, bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        savedQueue: [
            Object.assign({}, baseJob, {
                rootGid: 'duplicate-root', childGid: '', stage: 'waiting-metadata'
            }),
            Object.assign({}, baseJob, {
                rootGid: 'original-root', childGid: 'existing', stage: 'waiting-files'
            })
        ],
        tasks: {
            'duplicate-root': {
                gid: 'duplicate-root', status: 'error', errorCode: '12',
                infoHash: infoHash, bittorrent: {}, files: []
            },
            existing: activeTask
        },
        activeTasks: [activeTask],
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'original-root');
    assert.deepStrictEqual(context.changedOptions, []);

    context.tickUntilIdle();
    assert.strictEqual(context.changedOptions.length, 1);
    assert.strictEqual(context.changedOptions[0].gid, 'existing');
    assert.strictEqual(context.service.getStatus().filtered, 1);
});

test('does not choose an arbitrary already-registered task when InfoHash matches are ambiguous', function () {
    const context = loadFilterService({
        tasks: {
            root: {
                gid: 'root', status: 'error', errorCode: '12',
                infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bittorrent: {}, files: []
            }
        },
        activeTasks: [
            {gid: 'one', status: 'active', infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
            {gid: 'two', status: 'active', infoHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}
        ]
    });

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    for (let i = 0; i < 6; i++) {
        context.tick();
    }

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].childGid, '');
    assert.strictEqual(context.getSavedQueue()[0].infoHash,
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
});

test('keeps a recovered Download Later remote-torrent child paused after filtering', function () {
    const child = {
        gid: 'child', following: 'root', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]
    };
    const context = loadFilterService({
        waitingTasks: [child],
        statusResponseForGid: function (gid) {
            return gid === 'child' ? {success: true, data: child} : {
                success: false, data: {message: 'No such download for GID#root'}
            };
        },
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });

    context.service.enqueue('root', {
        thresholdBytes: 104857600,
        startAfterFilter: false,
        sourceType: 'remote-torrent'
    });
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{
        gid: 'child',
        options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    }]);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('does not choose an arbitrary child when multiple paused tasks follow the same root', function () {
    const context = loadFilterService({
        waitingTasks: [
            {gid: 'child-a', following: 'root'},
            {gid: 'child-b', following: 'root'}
        ],
        statusResponseForGid: function () {
            return {success: false, data: {message: 'No such download for GID#root'}};
        }
    });

    context.service.enqueue('root', {
        thresholdBytes: 104857600,
        startAfterFilter: true,
        sourceType: 'magnet'
    });
    context.service.start();
    context.tick();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].childGid, '');
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
});

test('fully selected all-small and all-large tasks start without option changes', function () {
    const cases = [
        [{index: '1', length: '1', selected: 'true'}, {index: '2', length: '2', selected: 'true'}],
        [{index: '1', length: '209715200', selected: 'true'}, {index: '2', length: '314572800', selected: 'true'}]
    ];

    cases.forEach(function (files) {
        const context = loadFilterService({tasks: {
            task: {gid: 'task', status: 'paused', bittorrent: {mode: 'multi'}, files: files}
        }});
        context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'torrent'});
        context.service.start();
        context.tickUntilIdle();

        assert.deepStrictEqual(context.changedOptions, []);
        assert.deepStrictEqual(context.startedGids, ['task']);
        assert.strictEqual(context.getSavedQueue().length, 0);
    });
});

test('Download Later never starts a successfully filtered task', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'}
    });
    context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 1);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('three failed filter calls restore full selection and cleanup before fallback start', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'network'}},
            {success: true, data: 'OK'}
        ]
    });
    context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 4);
    assert.deepStrictEqual(context.changedOptions[3], {
        gid: 'task',
        options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}
    });
    assert.deepStrictEqual(context.startedGids, ['task']);
    assert.strictEqual(context.service.getStatus().type, 'warning');
    assert.strictEqual(context.notifications.length, 1);
    assert.strictEqual(context.notifications[0].options.type, 'warning');
    assert.strictEqual(context.timeouts[0].delay, 10000);
});

test('third uncertain filter response reconciles before restoring full selection', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '209715200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'network'}},
            {success: false, data: {message: 'connection closed'}}
        ],
        applyFailedChanges: function (callNumber) { return callNumber === 3; }
    });
    context.service.enqueue('task', {thresholdBytes: 104857600, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 3);
    context.changedOptions.forEach(function (change) {
        assert.deepStrictEqual(change.options, {
            'select-file': '2', 'bt-remove-unselected-file': 'true'
        });
    });
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('tellStatus network failure retains the job without consuming filter retries', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: []}},
        statusResponses: [{success: false, data: {message: 'Network Error'}}]
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].retryCount, 0);
    assert.strictEqual(context.changedOptions.length, 0);
});

test('a missing metadata root without a child remains queued and non-mutating', function () {
    const context = loadFilterService({statusResponses: [{
        success: false, data: {message: 'GID deadbeef is not found'}
    }]});
    context.service.enqueue('deadbeef', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].childGid, '');
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.notifications.length, 0);
});

test('sanitizes scalar and malformed persisted queues before exposing or starting jobs', function () {
    const scalarContext = loadFilterService({savedQueue: 'corrupt'});

    assert.deepStrictEqual(JSON.parse(JSON.stringify(scalarContext.service.getJobs())), []);
    scalarContext.service.enqueue('fresh', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    scalarContext.service.start();
    scalarContext.tick();
    assert.strictEqual(scalarContext.getSavedQueue().length, 1);
    assert.strictEqual(scalarContext.getSavedQueue()[0].rootGid, 'fresh');

    const valid = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'valid', childGid: null,
        thresholdBytes: 100, startAfterFilter: 'false', sourceType: 'magnet',
        stage: 'waiting-metadata', retryCount: -4, createdAt: 'bad', updatedAt: Infinity
    };
    const mixedContext = loadFilterService({savedQueue: [null, {}, {
        rpcIdentity: 'rpc', rootGid: 'bad-stage', thresholdBytes: 100,
        startAfterFilter: true, sourceType: 'magnet', stage: 'evil-stage'
    }, valid]});
    const sanitized = JSON.parse(JSON.stringify(mixedContext.service.getJobs()));

    assert.strictEqual(sanitized.length, 1);
    assert.strictEqual(sanitized[0].rootGid, 'valid');
    assert.strictEqual(sanitized[0].childGid, '');
    assert.strictEqual(sanitized[0].startAfterFilter, false);
    assert.strictEqual(sanitized[0].retryCount, 0);
    assert(Number.isFinite(sanitized[0].createdAt));
    assert(Number.isFinite(sanitized[0].updatedAt));
    assert.strictEqual(mixedContext.getSavedQueue().length, 1);

    mixedContext.service.getJobs().push({stage: 'evil-stage'});
    mixedContext.service.enqueue('', {thresholdBytes: -1, startAfterFilter: 'maybe', sourceType: 'other'});
    assert.strictEqual(mixedContext.service.getJobs().length, 1);
    assert.strictEqual(mixedContext.getSavedQueue().length, 1);
});

test('removes a missing metadata root after three consecutive empty reconciliation scans', function () {
    const context = loadFilterService({statusResponses: [
        {success: false, data: {message: 'GID deadbeef is not found'}},
        {success: false, data: {message: 'GID deadbeef is not found'}},
        {success: false, data: {message: 'GID deadbeef is not found'}}
    ]});
    context.service.enqueue('deadbeef', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();

    context.tick();
    context.tick();
    assert.strictEqual(context.getSavedQueue().length, 1);
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().visible, false);
    assert.deepStrictEqual(context.startedGids, []);
});

test('seeing a live root resets the consecutive missing-root scan count', function () {
    const context = loadFilterService({statusResponses: [
        {success: false, data: {message: 'GID root is not found'}},
        {success: false, data: {message: 'GID root is not found'}},
        {success: true, data: {gid: 'root', status: 'active', files: []}},
        {success: false, data: {message: 'GID root is not found'}},
        {success: false, data: {message: 'GID root is not found'}},
        {success: false, data: {message: 'GID root is not found'}}
    ]});
    context.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();

    for (let i = 0; i < 5; i++) {
        context.tick();
    }
    assert.strictEqual(context.getSavedQueue().length, 1);
    context.tick();
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('missing-root reconciliation ignores transient list failures and ambiguous children', function () {
    const transient = loadFilterService({
        statusResponseForGid: function () {
            return {success: false, data: {message: 'GID root is not found'}};
        },
        waitingListResponses: [
            {success: true, data: []},
            {success: false, data: {message: 'network'}},
            {success: true, data: []},
            {success: true, data: []}
        ]
    });
    transient.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    transient.service.start();
    transient.tick();
    transient.tick();
    transient.tick();
    assert.strictEqual(transient.getSavedQueue().length, 1);
    transient.tick();
    assert.strictEqual(transient.getSavedQueue().length, 0);

    const ambiguous = loadFilterService({
        statusResponseForGid: function () {
            return {success: false, data: {message: 'GID root is not found'}};
        },
        waitingTasks: [{gid: 'one', following: 'root'}, {gid: 'two', following: 'root'}]
    });
    ambiguous.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    ambiguous.service.start();
    for (let i = 0; i < 6; i++) {
        ambiguous.tick();
    }
    assert.strictEqual(ambiguous.getSavedQueue().length, 1);
});

test('completed and errored remote torrent roots settle after a bounded child creation race', function () {
    ['complete', 'error'].forEach(function (terminalStatus) {
        const context = loadFilterService({tasks: {
            root: {gid: 'root', status: terminalStatus, files: []}
        }});
        context.service.enqueue('root', {
            thresholdBytes: 100, startAfterFilter: true, sourceType: 'remote-torrent'
        });
        context.service.start();

        context.tick();
        context.tick();
        assert.strictEqual(context.getSavedQueue().length, 1);
        context.tick();

        assert.strictEqual(context.getSavedQueue().length, 0);
        assert.deepStrictEqual(context.startedGids, []);
        assert.strictEqual(context.service.getStatus().waiting, 0);
        assert.strictEqual(context.service.getStatus().full, 0);
        assert.strictEqual(context.service.getStatus().total, 0);
    });
});

test('a deleted local torrent is removed from the queue without a warning', function () {
    const context = loadFilterService({statusResponses: [{
        success: false, data: {message: 'No such download for GID#deleted'}
    }]});
    context.service.enqueue('deleted', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.notifications.length, 0);
    assert.strictEqual(context.service.getStatus().visible, false);
});

test('jobs for another RPC identity remain stored and unprocessed', function () {
    const foreignJob = {
        rpcIdentity: 'http|other|6800|jsonrpc', rootGid: 'foreign', childGid: '',
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet',
        stage: 'waiting-metadata', retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({savedQueue: [foreignJob]});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.statusGids, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'foreign');
});

test('start is idempotent and restored queues expose resuming status before processing', function () {
    const restoredJob = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'root', childGid: '',
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet',
        stage: 'waiting-metadata', retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({savedQueue: [restoredJob], tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    const statusObject = context.service.getStatus();

    context.service.start();
    context.service.start();

    assert.strictEqual(context.intervals.length, 1);
    assert.strictEqual(context.intervals[0].delay, 250);
    assert.strictEqual(context.service.getStatus(), statusObject);
    assert.strictEqual(statusObject.type, 'resuming');
    assert.strictEqual(statusObject.textKey, 'format.bt-file-filter.resuming');
    assert.strictEqual(statusObject.textParams.count, 1);
});

test('polling never overlaps while a task status request is pending', function () {
    const context = loadFilterService({deferStatus: true, tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    context.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();

    context.tick();
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.waiting');
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root']);

    context.resolveStatus();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root', 'root']);
});

test('dispatches one hundred ready jobs within one hundred 250ms coordinator ticks', function () {
    const tasks = {};
    const context = loadFilterService({tasks: tasks});

    for (let i = 0; i < 100; i++) {
        const gid = 'ready-' + i;
        tasks[gid] = {
            gid: gid,
            status: 'paused',
            bittorrent: {},
            files: [{index: '1', length: '200', selected: 'true'}]
        };
        context.service.enqueue(gid, {
            thresholdBytes: 100,
            startAfterFilter: false,
            sourceType: 'torrent'
        });
    }
    context.service.start();

    for (let tick = 0; tick < 100; tick++) {
        context.tick();
    }

    assert.strictEqual(context.intervals.length, 1);
    assert.strictEqual(context.intervals[0].delay, 250);
    assert.strictEqual(context.statusGids.length, 100);
    assert.strictEqual(context.service.getStatus().processed, 100);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);

    for (let idleTick = 0; idleTick < 10; idleTick++) {
        context.tick();
    }
    assert.strictEqual(context.statusGids.length, 100);
});

test('metadata waiting has no timeout and remains visible', function () {
    const context = loadFilterService({tasks: {
        root: {gid: 'root', status: 'active', files: []}
    }});
    context.service.enqueue('root', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'});
    context.service.start();

    for (let i = 0; i < 40; i++) {
        context.tick();
    }

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.waiting');
    assert.strictEqual(context.service.getStatus().textParams.count, 1);
});

test('successful filtering shows a stable complete summary and auto-hides after five seconds', function () {
    const context = loadFilterService({tasks: {task: {
        gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]
    }}, taskOptions: {'bt-remove-unselected-file': 'false'}});
    const statusObject = context.service.getStatus();
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.service.getStatus(), statusObject);
    assert.strictEqual(statusObject.type, 'complete');
    assert.strictEqual(statusObject.textKey, 'format.bt-file-filter.complete');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(statusObject.textParams)), {filtered: 1, full: 0});
    assert.strictEqual(context.timeouts[0].delay, 5000);
    context.timeouts[0].callback();
    assert.strictEqual(statusObject.visible, false);
});

test('reconciles a lost filter response without consuming another filter attempt', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [{success: false, data: {message: 'connection closed'}}],
        applyFailedChanges: true
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 1);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('reconciles a lost restoration response and keeps Download Later paused', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'true'},
        changeResponses: [
            {success: false, data: {message: 'failure 1'}},
            {success: false, data: {message: 'failure 2'}},
            {success: false, data: {message: 'failure 3'}},
            {success: false, data: {message: 'lost restore response'}}
        ],
        applyFailedChanges: function (callNumber) { return callNumber === 4; },
        normalizedSelectFile: '1-2'
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 4);
    assert.deepStrictEqual(context.changedOptions[3].options, {
        'select-file': '1,2', 'bt-remove-unselected-file': 'true'
    });
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().fallback, 1);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('switching RPC identity starts a separate aggregate batch', function () {
    const makeJob = function (rpcIdentity, gid) {
        return {
            rpcIdentity: rpcIdentity, rootGid: gid, childGid: '', thresholdBytes: 100,
            startAfterFilter: false, sourceType: 'torrent', stage: 'waiting-metadata',
            retryCount: 0, originalRemoveUnselectedFile: null
        };
    };
    const context = loadFilterService({
        rpcIdentity: 'rpc-a',
        savedQueue: [makeJob('rpc-a', 'a'), makeJob('rpc-b', 'b')],
        tasks: {
            a: {gid: 'a', status: 'paused', bittorrent: {}, files: [{index: '1', length: '200', selected: 'true'}]},
            b: {gid: 'b', status: 'paused', bittorrent: {}, files: [{index: '1', length: '200', selected: 'true'}]}
        }
    });
    context.service.start();
    context.tick();
    assert.strictEqual(context.service.getStatus().full, 1);

    context.setRpcIdentity('rpc-b');
    context.tick();

    assert.strictEqual(context.service.getStatus().total, 1);
    assert.strictEqual(context.service.getStatus().processed, 1);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.getSavedQueue().length, 0);
});

test('enqueue after an RPC switch counts stored and new jobs once', function () {
    const storedJob = {
        rpcIdentity: 'rpc-b', rootGid: 'stored', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', stage: 'waiting-metadata',
        retryCount: 0, originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({rpcIdentity: 'rpc-a', savedQueue: [storedJob]});
    context.service.start();
    context.setRpcIdentity('rpc-b');

    context.service.enqueue('new', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});

    assert.strictEqual(context.service.getStatus().total, 2);
    assert.strictEqual(context.getSavedQueue().length, 2);
});

test('startup summarizes and clears a queue containing only completed tombstones', function () {
    const baseJob = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', retryCount: 0,
        originalRemoveUnselectedFile: null
    };
    const context = loadFilterService({savedQueue: [
        Object.assign({}, baseJob, {rootGid: 'filtered', stage: 'completed-filtered'}),
        Object.assign({}, baseJob, {rootGid: 'full', stage: 'completed-full'})
    ]});

    context.service.start();

    assert.strictEqual(context.service.getStatus().type, 'complete');
    assert.strictEqual(context.service.getStatus().total, 2);
    assert.strictEqual(context.service.getStatus().processed, 2);
    assert.strictEqual(context.service.getStatus().filtered, 1);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
    assert.deepStrictEqual(context.statusGids, []);
});

test('enqueue alongside a completed tombstone preserves the whole batch aggregate', function () {
    const baseJob = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', retryCount: 0,
        originalRemoveUnselectedFile: null
    };
    const tasks = {
        existing: {gid: 'existing', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]},
        added: {gid: 'added', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '300', selected: 'true'}
        ]}
    };
    const context = loadFilterService({tasks: tasks, savedQueue: [
        Object.assign({}, baseJob, {rootGid: 'done', stage: 'completed-full'}),
        Object.assign({}, baseJob, {rootGid: 'existing', stage: 'waiting-metadata'})
    ]});

    context.service.start();
    context.service.enqueue('added', {
        thresholdBytes: 100,
        startAfterFilter: false,
        sourceType: 'torrent'
    });
    context.tickUntilIdle();

    assert.strictEqual(context.service.getStatus().type, 'complete');
    assert.strictEqual(context.service.getStatus().total, 3);
    assert.strictEqual(context.service.getStatus().processed, 3);
    assert.strictEqual(context.service.getStatus().full, 3);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
});

test('defers fallback notification while the current batch is still waiting', function () {
    const context = loadFilterService({
        tasks: {
            failed: {gid: 'failed', status: 'paused', bittorrent: {}, files: [
                {index: '1', length: '1', selected: 'true'},
                {index: '2', length: '200', selected: 'true'}
            ]},
            waiting: {gid: 'waiting', status: 'active', files: []}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false, data: {message: 'failure 1'}},
            {success: false, data: {message: 'failure 2'}},
            {success: false, data: {message: 'failure 3'}},
            {success: true, data: 'OK'}
        ]
    });
    context.service.enqueue('failed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();

    for (let i = 0; i < 10; i++) {
        context.tick();
    }

    assert.strictEqual(context.notifications.length, 0);
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textParams.count, 1);
    assert.strictEqual(context.getSavedQueue().length, 2);
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'waiting' && job.stage === 'waiting-metadata';
    }));
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'failed' && job.stage === 'completed-fallback';
    }));
});

test('persists completed batch outcomes across reload until the last job settles', function () {
    const failedTask = {gid: 'failed', status: 'paused', bittorrent: {}, files: [
        {index: '1', length: '1', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]};
    const first = loadFilterService({
        tasks: {
            failed: failedTask,
            waiting: {gid: 'waiting', status: 'active', files: []}
        },
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false}, {success: false}, {success: false}, {success: true}
        ]
    });
    first.service.enqueue('failed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    first.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    first.service.start();

    for (let i = 0; i < 10 && first.service.getStatus().fallback < 1; i++) {
        first.tick();
    }

    const persisted = JSON.parse(JSON.stringify(first.getSavedQueue()));
    assert.strictEqual(persisted.length, 2);
    assert(persisted.some(function (job) {
        return job.rootGid === 'failed' && job.stage === 'completed-fallback';
    }));
    assert(persisted.some(function (job) {
        return job.rootGid === 'waiting' && job.stage === 'waiting-metadata';
    }));
    assert.strictEqual(first.notifications.length, 0);

    const second = loadFilterService({
        savedQueue: persisted,
        tasks: {
            waiting: {gid: 'waiting', status: 'complete', followedBy: ['waiting-child'], bittorrent: {}, files: [
                {index: '1', path: '[METADATA]hash', length: '100', selected: 'true'}
            ]},
            'waiting-child': {gid: 'waiting-child', following: 'waiting', status: 'paused', bittorrent: {}, files: [
                {index: '1', length: '200', selected: 'true'}
            ]}
        }
    });
    second.service.start();
    second.tickUntilIdle();

    assert.strictEqual(second.notifications.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(second.notifications[0].options.contentParams)), {count: 1});
    assert.strictEqual(second.service.getStatus().filtered, 0);
    assert.strictEqual(second.service.getStatus().full, 1);
    assert.strictEqual(second.service.getStatus().fallback, 1);
    assert.strictEqual(second.service.getStatus().processed, 2);
    assert.strictEqual(second.service.getStatus().total, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(second.getSavedQueue())), []);
});

test('preserves completed outcomes through an RPC switch round trip', function () {
    const tasks = {
        failed: {gid: 'failed', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]},
        waiting: {gid: 'waiting', status: 'active', files: []},
        other: {gid: 'other', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    };
    const context = loadFilterService({
        rpcIdentity: 'rpc-a',
        tasks: tasks,
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false}, {success: false}, {success: false}, {success: true}
        ]
    });
    context.service.enqueue('failed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    for (let i = 0; i < 10 && context.service.getStatus().fallback < 1; i++) {
        context.tick();
    }

    context.setRpcIdentity('rpc-b');
    context.service.enqueue('other', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.tickUntilIdle();

    tasks.waiting = {gid: 'waiting', status: 'complete', followedBy: ['waiting-child'], bittorrent: {}, files: [
        {index: '1', path: '[METADATA]hash', length: '100', selected: 'true'}
    ]};
    tasks['waiting-child'] = {gid: 'waiting-child', following: 'waiting', status: 'paused', bittorrent: {}, files: [
        {index: '1', length: '200', selected: 'true'}
    ]};
    context.setRpcIdentity('rpc-a');
    context.tickUntilIdle();

    assert.strictEqual(context.notifications.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.notifications[0].options.contentParams)), {count: 1});
    assert.strictEqual(context.service.getStatus().fallback, 1);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.service.getStatus().processed, 2);
    assert.strictEqual(context.service.getStatus().total, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
});

test('emits one fallback notification with the final completed batch count', function () {
    const makeTask = function (gid) {
        return {gid: gid, status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]};
    };
    const context = loadFilterService({
        tasks: {one: makeTask('one'), two: makeTask('two')},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [
            {success: false}, {success: false}, {success: false}, {success: false},
            {success: false}, {success: false}, {success: true}, {success: true}
        ]
    });
    context.service.enqueue('one', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('two', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.notifications.length, 1);
    assert.strictEqual(context.notifications[0].content, 'format.bt-file-filter.fallback');
    assert.strictEqual(context.notifications[0].options.type, 'warning');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.notifications[0].options.contentParams)), {count: 2});
    assert.strictEqual(context.service.getStatus().fallback, 2);
});

test('all-small partial selection restores every file and the original cleanup option', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'false'},
            {index: '2', length: '2', selected: 'true'}
        ]}},
        taskOptions: {'select-file': '2', 'bt-remove-unselected-file': 'true'}
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, [{gid: 'task', options: {
        'select-file': '1,2', 'bt-remove-unselected-file': 'true'
    }}]);
    assert.deepStrictEqual(context.startedGids, ['task']);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
});

test('all-large partial selection preserves user options and keeps Download Later paused', function () {
    const taskOptions = {'select-file': '1', 'bt-remove-unselected-file': 'true'};
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'},
            {index: '2', length: '300', selected: 'false'}
        ]}},
        taskOptions: taskOptions
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(taskOptions, {'select-file': '1', 'bt-remove-unselected-file': 'true'});
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
});

test('uncertain full restoration reconciles before completing Download Later', function () {
    const context = loadFilterService({
        tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'false'},
            {index: '2', length: '2', selected: 'true'}
        ]}},
        taskOptions: {'bt-remove-unselected-file': 'false'},
        changeResponses: [{success: false, data: {message: 'connection closed'}}],
        applyFailedChanges: true
    });
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();
    context.tickUntilIdle();

    assert.strictEqual(context.changedOptions.length, 1);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().full, 1);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('a metadata-waiting job does not block later ready jobs', function () {
    const context = loadFilterService({tasks: {
        waiting: {gid: 'waiting', status: 'active', files: []},
        ready: {gid: 'ready', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('waiting', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.enqueue('ready', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.start();

    context.tick();
    context.tick();

    assert.deepStrictEqual(context.statusGids, ['waiting', 'ready']);
    assert.strictEqual(context.getSavedQueue().length, 2);
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'waiting' && job.stage === 'waiting-metadata';
    }));
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'ready' && job.stage === 'completed-full';
    }));
});

test('RPC switch after tellStatus does not continue the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferStatus: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveStatus();

    assert.deepStrictEqual(context.optionRpcIdentities, []);
    assert.deepStrictEqual(context.changeRpcIdentities, []);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
});

test('RPC switch during metadata-child discovery cannot mutate either endpoint queue', function () {
    const context = loadFilterService({
        rpcIdentity: 'rpc-a',
        deferWaitingList: true,
        statusResponses: [{success: false, data: {message: 'No such download for GID#root-a'}}]
    });
    context.service.enqueue('root-a', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.service.enqueue('root-b', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.resolveWaitingList({
        success: true,
        data: [{gid: 'child-a', following: 'root-a'}]
    });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue().map(function (job) {
        return {rpcIdentity: job.rpcIdentity, rootGid: job.rootGid, childGid: job.childGid};
    }))), [
        {rpcIdentity: 'rpc-a', rootGid: 'root-a', childGid: ''},
        {rpcIdentity: 'rpc-b', rootGid: 'root-b', childGid: ''}
    ]);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
});

test('RPC switch after getOption does not change the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferOptions: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveOptions();

    assert.deepStrictEqual(context.optionRpcIdentities, ['rpc-a']);
    assert.deepStrictEqual(context.changeRpcIdentities, []);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
});

test('RPC switch after changeOption does not start or remove the A job against B', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferChange: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveChange();

    assert.deepStrictEqual(context.changeRpcIdentities, ['rpc-a']);
    assert.deepStrictEqual(context.startRpcIdentities, []);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'applying-filter');
});

test('RPC switch after unpause does not remove the A job from B callback context', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a', deferStart: true, tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'});
    context.service.start();
    context.tick();

    context.setRpcIdentity('rpc-b');
    context.resolveStart();

    assert.deepStrictEqual(context.startRpcIdentities, ['rpc-a']);
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].stage, 'starting-full');
});

test('removed task in a starting stage is silently discarded', function () {
    const job = {
        rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'task', childGid: '', thresholdBytes: 100,
        startAfterFilter: true, sourceType: 'torrent', stage: 'starting-filtered',
        retryCount: 0, originalRemoveUnselectedFile: 'false'
    };
    const context = loadFilterService({savedQueue: [job], tasks: {
        task: {gid: 'task', status: 'removed', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
    assert.strictEqual(context.service.getStatus().filtered, 0);
    assert.strictEqual(context.service.getStatus().full, 0);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('removed BT task waiting for metadata is silently discarded before filtering', function () {
    const context = loadFilterService({tasks: {
        task: {gid: 'task', status: 'removed', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('task', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'torrent'
    });
    context.service.start();
    context.tick();

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 0);
    assert.strictEqual(context.service.getStatus().full, 0);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('removed BT task in an option-mutation stage is silently discarded', function () {
    ['applying-filter', 'restoring-full'].forEach(function (stage) {
        const job = {
            rpcIdentity: 'http|localhost|6800|jsonrpc', rootGid: 'task', childGid: '', thresholdBytes: 100,
            startAfterFilter: true, sourceType: 'torrent', stage: stage,
            retryCount: stage === 'restoring-full' ? 3 : 0, originalRemoveUnselectedFile: 'false',
            allIndexes: [1, 2], selectedIndexes: [2], restorationOutcome: 'fallback'
        };
        const context = loadFilterService({savedQueue: [job], tasks: {
            task: {gid: 'task', status: 'removed', bittorrent: {}, files: [
                {index: '1', length: '1', selected: 'true'},
                {index: '2', length: '200', selected: 'true'}
            ]}
        }, taskOptions: {'bt-remove-unselected-file': 'false'}});
        context.service.start();
        context.tick();

        assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), [], stage);
        assert.deepStrictEqual(context.changedOptions, [], stage);
        assert.deepStrictEqual(context.startedGids, [], stage);
        assert.strictEqual(context.service.getStatus().filtered, 0, stage);
        assert.strictEqual(context.service.getStatus().full, 0, stage);
        assert.strictEqual(context.service.getStatus().fallback, 0, stage);
        assert.strictEqual(context.notifications.length, 0, stage);
    });
});

test('direct metadata child discovery waits for exactly one child before mutating', function () {
    const tasks = {
        root: {gid: 'root', status: 'complete', followedBy: ['child-a', 'child-b'], files: []},
        child: {gid: 'child', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    };
    const context = loadFilterService({tasks: tasks, taskOptions: {'bt-remove-unselected-file': 'false'}});
    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].childGid, '');
    assert.strictEqual(context.getSavedQueue()[0].stage, 'waiting-metadata');
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);

    tasks.root.followedBy = ['child'];
    context.tick();
    assert.strictEqual(context.getSavedQueue()[0].childGid, 'child');
    context.tick();

    assert.deepStrictEqual(context.changedOptions, [{gid: 'child', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'true'
    }}]);
    assert.deepStrictEqual(context.startedGids, ['child']);
    assert.strictEqual(context.service.getStatus().filtered, 1);
});

test('terminal non-BT remote torrent root settles as non-applicable', function () {
    const context = loadFilterService({tasks: {
        root: {gid: 'root', status: 'complete', files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'remote-torrent'
    });
    context.service.start();

    for (let i = 0; i < 3; i++) {
        context.tick();
    }

    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedQueue())), []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getStatus().filtered, 0);
    assert.strictEqual(context.service.getStatus().full, 0);
    assert.strictEqual(context.service.getStatus().fallback, 0);
    assert.strictEqual(context.service.getStatus().total, 0);
    assert.strictEqual(context.notifications.length, 0);
});

test('restoration reconciliation preserves a present falsy cleanup value', function () {
    const job = {
        rpcIdentity: 'rpc-a', rootGid: 'task', childGid: '', thresholdBytes: 100,
        startAfterFilter: false, sourceType: 'torrent', stage: 'restoring-full',
        retryCount: 3, originalRemoveUnselectedFile: '', restoreAttempted: true,
        allIndexes: [1, 2], selectedIndexes: [2]
    };
    const context = loadFilterService({rpcIdentity: 'rpc-a', savedQueue: [job], tasks: {
        task: {gid: 'task', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '1', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]}
    }, taskOptions: {'select-file': '1,2', 'bt-remove-unselected-file': ''}});
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().fallback, 1);
});

test('switching to an RPC identity without jobs clears the previous toolbar status', function () {
    const context = loadFilterService({rpcIdentity: 'rpc-a'});
    context.service.enqueue('task', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    assert.strictEqual(context.service.getStatus().visible, true);

    context.setRpcIdentity('rpc-b');
    context.tick();

    assert.strictEqual(context.service.getStatus().visible, false);
    assert.strictEqual(context.service.getStatus().type, 'idle');
    assert.strictEqual(context.service.getStatus().total, 0);
});

test('an unresolved missing root remains queued after another job completes', function () {
    const context = loadFilterService({tasks: {
        completed: {gid: 'completed', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueue('completed', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'});
    context.service.enqueue('deleted', {thresholdBytes: 100, startAfterFilter: false, sourceType: 'magnet'});
    context.service.start();
    context.tick();
    context.tick();

    assert.strictEqual(context.getSavedQueue().length, 2);
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'deleted' && job.stage === 'waiting-metadata';
    }));
    assert(context.getSavedQueue().some(function (job) {
        return job.rootGid === 'completed' && job.stage === 'completed-full';
    }));
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.waiting');
    assert.strictEqual(context.service.getStatus().processed, 1);
    assert.strictEqual(context.service.getStatus().total, 2);
});

const createActiveBtPayload = function (gid, files) {
    return {
        gid: gid,
        status: 'active',
        infoHash: '0123456789abcdef0123456789abcdef01234567',
        bittorrent: {mode: 'multi', info: {name: gid}},
        files: files,
        seeder: false
    };
};

const createApplyingBulkStorage = function (gid) {
    const rpcIdentity = 'http|localhost|6800|jsonrpc';
    return {
        savedBulkRuns: [{
            rpcIdentity: rpcIdentity,
            thresholdBytes: 100,
            gids: [gid]
        }],
        savedBulkProgresses: [{
            rpcIdentity: rpcIdentity,
            cursor: 0,
            processed: 0,
            filtered: 0,
            skipped: 0,
            failed: 0,
            filteredFiles: 0,
            current: {
                gid: gid,
                stage: 'applying',
                retryCount: 1,
                restoreRetryCount: 0,
                filteredFileCount: 1,
                originalSelectedIndexes: [1, 2],
                targetSelectedIndexes: [2],
                originalRemoveUnselectedFile: 'false',
                targetRemoveUnselectedFile: 'true'
            }
        }]
    };
};

test('classifies only active BT payload downloads and preserves existing file choices', function () {
    const context = loadFilterService();
    const task = createActiveBtPayload('payload', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'false'}
    ]);

    assert.strictEqual(context.service.isActiveBtPayloadTask(task), true);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {seeder: 'false'})), true);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {
        bittorrent: {mode: 'multi'},
        files: [{index: '1', path: '[METADATA]payload', length: '0', selected: 'true'}]
    })), false);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {status: 'waiting'})), false);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {seeder: true})), false);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {verifiedLength: '0'})), false);
    assert.strictEqual(context.service.isActiveBtPayloadTask(Object.assign({}, task, {
        verifyIntegrityPending: 'true'
    })), false);

    const plan = context.service.planExistingTaskFiles(task.files, 100);
    assert.strictEqual(plan.mode, 'filter');
    assert.deepStrictEqual(Array.from(plan.originalSelectedIndexes), [1, 2]);
    assert.deepStrictEqual(Array.from(plan.targetSelectedIndexes), [2]);
    assert.deepStrictEqual(Array.from(plan.allIndexes), [1, 2, 3]);
    assert.strictEqual(plan.filteredFileCount, 1);
});

test('previews only payload tasks whose current selection can be narrowed', function () {
    const context = loadFilterService();
    const candidate = createActiveBtPayload('candidate', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const allSmall = createActiveBtPayload('all-small', [
        {index: '1', length: '20', selected: 'true'}
    ]);
    const metadata = {
        gid: 'metadata', status: 'active', infoHash: candidate.infoHash,
        bittorrent: {mode: 'single'},
        files: [{index: '1', path: '[METADATA]name', length: '0', selected: 'true'}]
    };
    const preview = context.service.getBulkPreview([candidate, allSmall, metadata], 100);

    assert.deepStrictEqual(Array.from(preview.gids), ['candidate']);
    assert.strictEqual(preview.taskCount, 1);
    assert.strictEqual(preview.fileCount, 1);
});

test('does not bulk-preview a BT child still owned by automatic filtering', function () {
    const context = loadFilterService();
    const task = createActiveBtPayload('child', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    task.following = 'root';
    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });

    const preview = context.service.getBulkPreview([task], 100);

    assert.deepStrictEqual(Array.from(preview.gids), []);
    assert.strictEqual(preview.taskCount, 0);
    assert.strictEqual(preview.fileCount, 0);
});

test('does not bulk-preview an InfoHash-recovered child without a following link', function () {
    const context = loadFilterService({savedQueue: [{
        rpcIdentity: 'http|localhost|6800|jsonrpc',
        rootGid: 'duplicate-root',
        childGid: 'existing-child',
        thresholdBytes: 100,
        startAfterFilter: true,
        sourceType: 'magnet',
        stage: 'waiting-files',
        retryCount: 0,
        preserveExistingSelection: true
    }]});
    const task = createActiveBtPayload('existing-child', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);

    const preview = context.service.getBulkPreview([task], 100);

    assert.deepStrictEqual(Array.from(preview.gids), []);
    assert.strictEqual(preview.taskCount, 0);
    assert.strictEqual(preview.fileCount, 0);
});

test('previews one hundred thousand BT files in one linear file pass', function () {
    const context = loadFilterService();
    const tasks = [];
    let filePropertyReads = 0;
    for (let taskIndex = 0; taskIndex < 1000; taskIndex++) {
        const files = [];
        for (let fileIndex = 1; fileIndex <= 100; fileIndex++) {
            const values = {
                index: String(fileIndex),
                length: fileIndex <= 50 ? '50' : '150',
                selected: 'true'
            };
            const file = {};
            ['index', 'length', 'selected'].forEach(function (key) {
                Object.defineProperty(file, key, {
                    enumerable: true,
                    get: function () {
                        filePropertyReads++;
                        return values[key];
                    }
                });
            });
            files.push(file);
        }
        tasks.push(createActiveBtPayload('task-' + taskIndex, files));
    }

    const preview = context.service.getBulkPreview(tasks, 100);

    assert.strictEqual(preview.taskCount, 1000);
    assert.strictEqual(preview.fileCount, 50000);
    assert.strictEqual(filePropertyReads, 300000);
});

test('exposes the current bulk task, stage, threshold, and badge mapping while applying', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {bulk: task}, deferChange: true});

    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tick();

    assert.strictEqual(context.service.getBulkStatus().currentGid, 'bulk');
    assert.strictEqual(context.service.getBulkStatus().currentStage, 'applying');
    assert.strictEqual(context.service.getBulkStatus().thresholdBytes, 100);
    assert.strictEqual(context.service.getPendingGidStageMap().bulk, 'applying-filter');

    context.service.stop();
    assert.strictEqual(context.service.getPendingGidStageMap().bulk, undefined);
});

test('processes a bulk run one task at a time without pausing active downloads', function () {
    const tasks = {
        one: createActiveBtPayload('one', [
            {index: '1', length: '20', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]),
        two: createActiveBtPayload('two', [
            {index: '1', length: '30', selected: 'true'},
            {index: '2', length: '300', selected: 'true'}
        ])
    };
    const context = loadFilterService({tasks: tasks, taskOptions: {
        one: {'bt-remove-unselected-file': 'false'},
        two: {'bt-remove-unselected-file': 'false'}
    }});

    assert.strictEqual(context.service.enqueueBulk(['one', 'two'], 100), true);
    context.service.start();
    context.tickMany(20);

    assert.deepStrictEqual(context.pausedGids, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.deepStrictEqual(context.changedOptions, [
        {gid: 'one', options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}},
        {gid: 'two', options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}}
    ]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedBulkRuns())), []);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().filtered, 2);
    assert.strictEqual(context.service.getBulkStatus().filteredFiles, 2);

    context.timeouts[context.timeouts.length - 1].callback();
    assert.strictEqual(context.service.getBulkStatus().visible, false);
    assert.strictEqual(context.service.getBulkStatus().type, 'idle');
});

test('does not inspect the next bulk task while the current option change is unresolved', function () {
    const tasks = {
        one: createActiveBtPayload('one', [
            {index: '1', length: '20', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]),
        two: createActiveBtPayload('two', [
            {index: '1', length: '20', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ])
    };
    const context = loadFilterService({tasks: tasks, deferChange: true});
    context.service.enqueueBulk(['one', 'two'], 100);
    context.service.start();
    context.tick();
    context.tickMany(5);

    assert.deepStrictEqual(context.statusGids, ['one']);
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['one']);

    context.resolveChange();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['one', 'two']);
});

test('keeps the immutable bulk GID definition separate from the current checkpoint', function () {
    const task = createActiveBtPayload('one', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {one: task}, deferChange: true});
    context.service.enqueueBulk(['one'], 100);
    context.service.start();
    context.tick();

    const definition = JSON.parse(JSON.stringify(context.getSavedBulkRuns()[0]));
    const progress = JSON.parse(JSON.stringify(context.getSavedBulkProgresses()[0]));
    assert.deepStrictEqual(definition.gids, ['one']);
    assert.strictEqual(definition.current, undefined);
    assert.strictEqual(progress.current.gid, 'one');
    assert.strictEqual(progress.current.stage, 'applying');
    assert.deepStrictEqual(progress.current.originalSelectedIndexes, [1, 2]);
    assert.deepStrictEqual(progress.current.targetSelectedIndexes, [2]);
});

test('enqueues one thousand bulk gids with two storage writes and one small checkpoint', function () {
    const context = loadFilterService();
    const gids = [];
    for (let i = 0; i < 1000; i++) {
        gids.push(('000000000000000' + i.toString(16)).slice(-16));
    }
    gids.push(gids[0]);
    const writesBefore = context.storageSets.length;

    assert.strictEqual(context.service.enqueueBulk(gids, 100), true);

    const writes = context.storageSets.slice(writesBefore);
    const definition = JSON.parse(JSON.stringify(context.getSavedBulkRuns()[0]));
    const progress = JSON.parse(JSON.stringify(context.getSavedBulkProgresses()[0]));
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(definition.gids.length, 1000);
    assert.strictEqual(progress.current, null);
    assert(writes[1].size < 300, 'bulk progress checkpoint grew with the GID queue');
});

test('reloads an applying bulk checkpoint and reconciles without a duplicate mutation', function () {
    const task = createActiveBtPayload('one', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const taskOptions = {'bt-remove-unselected-file': 'false'};
    const first = loadFilterService({
        tasks: {one: task},
        taskOptions: {one: taskOptions},
        deferChange: true
    });
    first.service.enqueueBulk(['one'], 100);
    first.service.start();
    first.tick();

    const restored = loadFilterService({
        tasks: {one: task},
        taskOptions: {one: taskOptions},
        savedBulkRuns: JSON.parse(JSON.stringify(first.getSavedBulkRuns())),
        savedBulkProgresses: JSON.parse(JSON.stringify(first.getSavedBulkProgresses()))
    });
    restored.service.start();
    restored.tick();

    assert.deepStrictEqual(restored.changedOptions, []);
    assert.strictEqual(restored.service.getBulkStatus().type, 'complete');
    assert.strictEqual(restored.service.getBulkStatus().filtered, 1);
});

test('does not reapply a restored bulk checkpoint to an ineligible task', function () {
    const variants = [
        {name: 'paused', apply: function (task) { task.status = 'paused'; }},
        {name: 'waiting', apply: function (task) { task.status = 'waiting'; }},
        {name: 'seeding', apply: function (task) { task.seeder = true; }},
        {name: 'verifying', apply: function (task) { task.verifiedLength = '0'; }},
        {name: 'pending verification', apply: function (task) {
            task.verifyIntegrityPending = 'true';
        }}
    ];

    variants.forEach(function (variant) {
        const task = createActiveBtPayload('task', [
            {index: '1', length: '20', selected: 'true'},
            {index: '2', length: '200', selected: 'true'}
        ]);
        variant.apply(task);
        const context = loadFilterService(Object.assign({
            tasks: {task: task},
            taskOptions: {task: {'bt-remove-unselected-file': 'false'}}
        }, createApplyingBulkStorage('task')));

        context.service.start();
        context.tick();

        assert.deepStrictEqual(context.changedOptions, [], variant.name);
        assert.strictEqual(context.service.getBulkStatus().type, 'complete', variant.name);
        assert.strictEqual(context.service.getBulkStatus().skipped, 1, variant.name);
    });
});

test('only restores a changed ineligible task from an applying checkpoint', function () {
    const task = createActiveBtPayload('task', [
        {index: '1', length: '20', selected: 'false'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'true'}
    ]);
    task.status = 'paused';
    const context = loadFilterService(Object.assign({
        tasks: {task: task},
        taskOptions: {task: {'bt-remove-unselected-file': 'true'}}
    }, createApplyingBulkStorage('task')));

    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, [{gid: 'task', options: {
        'select-file': '1,2', 'bt-remove-unselected-file': 'false'
    }}]);
    assert.strictEqual(context.service.getBulkStatus().failed, 1);
});

test('does not enable cleanup for a task that was already partially selected', function () {
    const task = createActiveBtPayload('partial', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'false'}
    ]);
    const context = loadFilterService({tasks: {partial: task}, taskOptions: {
        partial: {'bt-remove-unselected-file': 'false'}
    }});

    context.service.enqueueBulk(['partial'], 100);
    context.service.start();
    context.tickMany(12);

    assert.deepStrictEqual(context.changedOptions, [{gid: 'partial', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'false'
    }}]);
});

test('skips a bulk candidate that is no longer active before processing it', function () {
    const task = createActiveBtPayload('moved', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {moved: task}});
    context.service.enqueueBulk(['moved'], 100);
    task.status = 'waiting';
    context.service.start();
    context.tickMany(6);

    assert.deepStrictEqual(context.pausedGids, []);
    assert.deepStrictEqual(context.changedOptions, []);
    assert.deepStrictEqual(context.startedGids, []);
    assert.strictEqual(context.service.getBulkStatus().skipped, 1);
});

test('skips a stale bulk snapshot after an automatic job adopts its following child', function () {
    const child = createActiveBtPayload('child', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    child.following = 'root';
    const context = loadFilterService({tasks: {
        root: {gid: 'root', status: 'active', followedBy: ['child'], bittorrent: {}, files: []},
        child: child
    }});
    const stalePreview = context.service.getBulkPreview([child], 100);

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.enqueueBulk(stalePreview.gids, 100);
    context.service.start();
    context.tick();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().skipped, 1);
});

test('skips a stale bulk snapshot after InfoHash recovery adopts a child without following', function () {
    const child = createActiveBtPayload('existing-child', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({
        tasks: {
            root: {
                gid: 'root', status: 'error', errorCode: '12', infoHash: child.infoHash,
                bittorrent: {}, files: []
            },
            'existing-child': child
        },
        activeTasks: [child]
    });
    const stalePreview = context.service.getBulkPreview([child], 100);

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.enqueueBulk(stalePreview.gids, 100);
    context.service.start();
    context.tick();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().skipped, 1);
});

test('skips a bulk item adopted by automatic filtering during option inspection', function () {
    const child = createActiveBtPayload('child', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    child.following = 'root';
    const context = loadFilterService({tasks: {child: child}, deferOptions: true});
    context.service.enqueueBulk(['child'], 100);
    context.service.start();
    context.tick();

    context.service.enqueue('root', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.resolveOptions();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().skipped, 1);
});

test('uses the latest file selection after option inspection before bulk mutation', function () {
    const serverTask = createActiveBtPayload('task', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'true'}
    ]);
    const context = loadFilterService({
        deferOptions: true,
        statusResponseForGid: function () {
            return {success: true, data: JSON.parse(JSON.stringify(serverTask))};
        }
    });
    context.service.enqueueBulk(['task'], 100);
    context.service.start();
    context.tick();
    serverTask.files[2].selected = 'false';

    context.resolveOptions();

    assert.deepStrictEqual(context.changedOptions, [{gid: 'task', options: {
        'select-file': '2', 'bt-remove-unselected-file': 'false'
    }}]);
});

test('skips a bulk task paused while option inspection is in flight', function () {
    const serverTask = createActiveBtPayload('task', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({
        deferOptions: true,
        statusResponseForGid: function () {
            return {success: true, data: JSON.parse(JSON.stringify(serverTask))};
        }
    });
    context.service.enqueueBulk(['task'], 100);
    context.service.start();
    context.tick();
    serverTask.status = 'paused';

    context.resolveOptions();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.service.getBulkStatus().skipped, 1);
});

test('restores the exact original selection after three failed bulk changes', function () {
    const task = createActiveBtPayload('partial', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'false'}
    ]);
    const taskOptions = {'bt-remove-unselected-file': 'false'};
    const context = loadFilterService({
        tasks: {partial: task},
        taskOptions: {partial: taskOptions},
        changeResponses: [
            {success: false}, {success: false}, {success: false}, {success: true}
        ]
    });
    context.service.enqueueBulk(['partial'], 100);
    context.service.start();
    context.tick();
    context.tick();
    context.tick();

    task.files[0].selected = 'false';
    task.files[1].selected = 'true';
    task.files[2].selected = 'true';
    taskOptions['bt-remove-unselected-file'] = 'true';
    context.tick();

    assert.deepStrictEqual(context.changedOptions[3], {gid: 'partial', options: {
        'select-file': '1,2', 'bt-remove-unselected-file': 'false'
    }});
    assert.strictEqual(context.service.getBulkStatus().failed, 1);
    assert.deepStrictEqual(context.pausedGids, []);
    assert.deepStrictEqual(context.startedGids, []);
});

test('stops rollback after three persisted attempts and continues the bulk run', function () {
    const first = createActiveBtPayload('first', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'},
        {index: '3', length: '300', selected: 'false'}
    ]);
    const second = createActiveBtPayload('second', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const taskOptions = {
        first: {'bt-remove-unselected-file': 'false'},
        second: {'bt-remove-unselected-file': 'false'}
    };
    const context = loadFilterService({
        tasks: {first: first, second: second},
        taskOptions: taskOptions,
        changeResponses: [
            {success: false}, {success: false}, {success: false},
            {success: false}, {success: false}, {success: false}
        ]
    });
    context.service.enqueueBulk(['first', 'second'], 100);
    context.service.start();
    context.tick();
    context.tick();
    context.tick();

    first.files[0].selected = 'false';
    first.files[1].selected = 'true';
    first.files[2].selected = 'true';
    taskOptions.first['bt-remove-unselected-file'] = 'true';

    context.tick();
    assert.strictEqual(context.getSavedBulkProgresses()[0].current.restoreRetryCount, 1);
    context.tick();
    assert.strictEqual(context.getSavedBulkProgresses()[0].current.restoreRetryCount, 2);
    context.tick();
    assert.strictEqual(context.getSavedBulkProgresses()[0].current.restoreRetryCount, 3);
    context.tick();
    context.tickMany(4);

    assert.deepStrictEqual(context.changedOptions, [
        {gid: 'first', options: {'select-file': '2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'first', options: {'select-file': '2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'first', options: {'select-file': '2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'first', options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'first', options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'first', options: {'select-file': '1,2', 'bt-remove-unselected-file': 'false'}},
        {gid: 'second', options: {'select-file': '2', 'bt-remove-unselected-file': 'true'}}
    ]);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().processed, 2);
    assert.strictEqual(context.service.getBulkStatus().failed, 1);
    assert.strictEqual(context.service.getBulkStatus().filtered, 1);
});

test('preserves the rollback retry limit across reload', function () {
    const task = createActiveBtPayload('task', [
        {index: '1', length: '20', selected: 'false'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const storage = createApplyingBulkStorage('task');
    storage.savedBulkProgresses[0].current.stage = 'restoring';
    storage.savedBulkProgresses[0].current.restoreRetryCount = 3;
    const context = loadFilterService(Object.assign({
        tasks: {task: task},
        taskOptions: {task: {'bt-remove-unselected-file': 'true'}}
    }, storage));

    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.changedOptions, []);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.strictEqual(context.service.getBulkStatus().failed, 1);
});

test('services a new-task filter job before advancing a bulk task', function () {
    const bulkTask = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {
        bulk: bulkTask,
        automatic: {gid: 'automatic', status: 'paused', bittorrent: {}, files: [
            {index: '1', length: '200', selected: 'true'}
        ]}
    }});
    context.service.enqueueBulk(['bulk'], 100);
    context.service.enqueue('automatic', {
        thresholdBytes: 100, startAfterFilter: false, sourceType: 'torrent'
    });
    context.service.start();
    context.tick();

    assert.deepStrictEqual(context.statusGids, ['automatic']);
    assert.deepStrictEqual(context.pausedGids, []);
});

test('advances a bulk run after one automatic turn even when metadata keeps waiting', function () {
    const bulkTask = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {
        bulk: bulkTask,
        automatic: {gid: 'automatic', status: 'active', bittorrent: {}, files: []}
    }});
    context.service.enqueueBulk(['bulk'], 100);
    context.service.enqueue('automatic', {
        thresholdBytes: 100, startAfterFilter: true, sourceType: 'magnet'
    });
    context.service.start();

    context.tick();
    assert.deepStrictEqual(context.statusGids, ['automatic']);

    context.tickMany(6);
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['bulk']);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert(context.service.getJobs().some(function (job) {
        return job.rootGid === 'automatic' && job.stage === 'waiting-metadata';
    }));
});

test('ignores an old bulk status callback after stop and keeps the restarted tick locked', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {bulk: task}, deferStatus: true});
    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tick();

    context.service.stop();
    context.service.start();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['bulk', 'bulk']);

    context.resolveStatus();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['bulk', 'bulk']);
    assert.deepStrictEqual(context.changedOptions, []);

    context.resolveStatus();
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['bulk']);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
});

test('does not continue a bulk RPC chain when stopped during option inspection', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {bulk: task}, deferOptions: true});
    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tick();
    context.service.stop();

    context.resolveOptions();
    assert.deepStrictEqual(context.changedOptions, []);

    context.service.start();
    context.tick();
    context.resolveOptions();
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['bulk']);
});

test('reconciles a stopped bulk option change without sending it twice after restart', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    const context = loadFilterService({tasks: {bulk: task}, deferChange: true});
    context.service.enqueueBulk(['bulk'], 100);
    context.service.start();
    context.tick();
    context.service.stop();
    context.resolveChange();

    context.service.start();
    context.tick();
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['bulk']);
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
});

test('discards an orphan bulk definition instead of reconstructing an uncommitted run', function () {
    const context = loadFilterService({
        savedBulkRuns: [{
            rpcIdentity: 'http|localhost|6800|jsonrpc',
            thresholdBytes: 100,
            gids: ['orphan']
        }],
        savedBulkProgresses: []
    });
    context.service.start();
    context.tickMany(4);

    assert.deepStrictEqual(context.statusGids, []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedBulkRuns())), []);
    assert.strictEqual(context.service.getBulkStatus().type, 'idle');
});

test('does not announce bulk completion until the terminal checkpoint is durable', function () {
    const task = createActiveBtPayload('bulk', [
        {index: '1', length: '20', selected: 'true'},
        {index: '2', length: '200', selected: 'true'}
    ]);
    let failTerminalRemoval = true;
    let failureArmed = false;
    const context = loadFilterService({
        tasks: {bulk: task},
        storageSetResult: function (key, value) {
            if (failureArmed && key === 'BtFileFilterBulkProgress' && value.length === 0 &&
                failTerminalRemoval) {
                failTerminalRemoval = false;
                return false;
            }
            return true;
        }
    });
    context.service.enqueueBulk(['bulk'], 100);
    failureArmed = true;
    context.service.start();
    context.tick();

    assert.strictEqual(context.service.getBulkStatus().type, 'running');
    assert.strictEqual(context.getSavedBulkProgresses().length, 1);

    context.tick();
    assert.strictEqual(context.service.getBulkStatus().type, 'complete');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.getSavedBulkProgresses())), []);
    assert.deepStrictEqual(context.changedOptions.map(function (item) { return item.gid; }), ['bulk']);
});

test('renders the remembered filter and global toolbar status', function () {
    const index = read('src/index.html');
    const styles = read('src/styles/core/core.css') +
        read('src/styles/theme/default.css') + read('src/styles/theme/default-dark.css');
    const language = read('src/scripts/config/defaultLanguage.js');
    const simplifiedChinese = read('src/langs/zh_Hans.txt');
    const traditionalChinese = read('src/langs/zh_Hant.txt');

    assert(index.includes('class="bt-file-filter-toolbar" ng-if="isNewTaskPage()"'));
    assert(index.includes('ng-model="btFileFilterContext.enabled"'));
    assert(index.includes('ng-model="btFileFilterContext.minSizeMb"'));
    assert(index.includes('ng-change="saveBtFileFilterSetting()"'));
    assert(index.includes('<span class="bt-file-filter-label" translate>Exclude BT task files smaller than</span>'));
    assert(index.includes('<span class="bt-file-filter-suffix" translate>BT file filter suffix</span>'));
    assert(index.includes("aria-label=\"{{'BT file filter threshold' | translate}}\""));
    assert(index.includes('bt-file-filter-status'));
    assert(index.includes('btFileFilterStatus.textKey | translate: btFileFilterStatus.textParams'));
    assert(index.includes('aria-invalid="{{btFileFilterContext.enabled && !isBtFileFilterValid()}}"'));
    assert(styles.includes('.bt-file-filter-toolbar'));
    assert(styles.includes('.bt-file-filter-status'));
    assert(styles.includes('.bt-file-filter-status-compact'));
    assert(styles.includes('@media (max-width: 767px)'));
    assert(language.includes("'format.bt-file-filter.resuming'"));
    assert(simplifiedChinese.includes('Exclude BT task files smaller than=排除 BT 任务中小于'));
    assert(simplifiedChinese.includes('BT file filter suffix=的文件'));
    assert(simplifiedChinese.includes('format.bt-file-filter.complete=BT 小文件处理完成：{{filtered}} 个任务已排除小文件，{{full}} 个任务保留全部文件'));
    assert(simplifiedChinese.includes('format.bt-file-filter.fallback={{count}} 个 BT 任务无法排除小文件，已回退为保留全部文件'));
    assert(traditionalChinese.includes('Exclude BT task files smaller than=排除 BT 工作中小於'));
});

test('compact filter status reports the count appropriate to each lifecycle state', function () {
    const index = read('src/index.html');
    const simplifiedChinese = read('src/langs/zh_Hans.txt');
    const compactStatusStart = index.indexOf('<span class="bt-file-filter-status-compact"');
    const compactStatus = index.slice(compactStatusStart, index.indexOf('</span>', compactStatusStart));

    assert(compactStatusStart >= 0);
    assert(compactStatus.includes("'format.bt-file-filter.compact.' + btFileFilterStatus.type"));
    assert(compactStatus.includes("btFileFilterStatus.type === 'warning' ? btFileFilterStatus.fallback"));
    assert(compactStatus.includes("btFileFilterStatus.type === 'complete' ? (btFileFilterStatus.filtered + btFileFilterStatus.full)"));
    assert(compactStatus.includes('processing: btFileFilterStatus.total'));
    assert(compactStatus.includes('waiting: btFileFilterStatus.textParams.count'));
    assert(compactStatus.includes('resuming: btFileFilterStatus.textParams.count'));
    assert(!compactStatus.includes('btFileFilterStatus.total - btFileFilterStatus.processed'));
    assert(simplifiedChinese.includes('format.bt-file-filter.compact.resuming=恢复 {{count}}'));
    assert(simplifiedChinese.includes('format.bt-file-filter.compact.waiting=等待 {{count}}'));
    assert(simplifiedChinese.includes('format.bt-file-filter.compact.processing=处理中 {{count}}'));
    assert(simplifiedChinese.includes('format.bt-file-filter.compact.complete=已处理 {{count}}'));
    assert(simplifiedChinese.includes('format.bt-file-filter.compact.warning=已回退 {{count}}'));
});

test('keeps the full filter status while the desktop toolbar still has room', function () {
    const core = read('src/styles/core/core.css');

    assert(!core.includes('@media (min-width: 992px) and (max-width: 1399px)'));
    assert(core.includes('@media (max-width: 991px)'));
});

test('scopes tablet search hiding to active filter controls or status', function () {
    const index = read('src/index.html');
    const core = read('src/styles/core/core.css');
    const toolbarBreakpoint = core.indexOf('@media (max-width: 1399px)');
    const globalSearchRule = '.main-header .navbar .navbar-searchbar {\n        display: none;\n    }';
    const scopedSearchRule = '.main-header .navbar.bt-file-filter-active .navbar-searchbar {';

    assert(index.includes("ng-class=\"{'bt-file-filter-active': isNewTaskPage() || showAutomaticBtFileFilterStatus() || showBulkBtFileFilterGlobalStatus()}\""));
    assert(toolbarBreakpoint >= 0);
    assert.strictEqual(core.indexOf(globalSearchRule, toolbarBreakpoint), -1);
    assert(core.indexOf(scopedSearchRule, toolbarBreakpoint) > toolbarBreakpoint);
});

test('keeps inactive task search compact at the narrow tablet boundary', function () {
    const core = read('src/styles/core/core.css');
    const narrowTabletBreakpoint = core.indexOf('@media (min-width: 768px) and (max-width: 899px)');
    const compactSearchRule = core.indexOf('.main-header .navbar:not(.bt-file-filter-active) .navbar-searchbar .form-control {',
        narrowTabletBreakpoint);

    assert(narrowTabletBreakpoint >= 0);
    assert(compactSearchRule > narrowTabletBreakpoint);
});

test('find shortcut only consumes the event while search is visible', function () {
    const visible = loadRootKeyboardContext(true);
    const visibleEvent = {prevented: false, preventDefault: function () { this.prevented = true; }};
    assert.strictEqual(visible.rootScope.keydownActions.find(visibleEvent), false);
    assert.strictEqual(visibleEvent.prevented, true);
    assert.strictEqual(visible.getFocusCount(), 1);

    const hidden = loadRootKeyboardContext(false);
    const hiddenEvent = {prevented: false, preventDefault: function () { this.prevented = true; }};
    assert.strictEqual(hidden.rootScope.keydownActions.find(hiddenEvent), undefined);
    assert.strictEqual(hiddenEvent.prevented, false);
    assert.strictEqual(hidden.getFocusCount(), 0);
});

test('styles the BT filter as an accessible grouped rule in every state', function () {
    const index = read('src/index.html');
    const core = read('src/styles/core/core.css');
    const light = read('src/styles/theme/default.css');
    const dark = read('src/styles/theme/default-dark.css');
    const mobileBreakpoint = core.indexOf('@media (max-width: 767px)');
    const mobileGroupRuleStart = core.indexOf('.main-header .navbar .nav > li.bt-file-filter-group.has-filter-rule {', mobileBreakpoint);
    const mobileGroupRule = core.slice(mobileGroupRuleStart, core.indexOf('}', mobileGroupRuleStart));
    const mobileRule = core.indexOf('.main-header .bt-file-filter-rule {', mobileBreakpoint);

    assert(index.includes('class="bt-file-filter-rule"'));
    assert(index.includes("'is-enabled': btFileFilterContext.enabled"));
    assert(index.includes("'has-error': btFileFilterContext.enabled && !isBtFileFilterValid()"));
    assert(index.includes('class="bt-file-filter-error"'));
    assert(index.includes('ng-if="btFileFilterContext.enabled && !isBtFileFilterValid()"'));
    assert(index.includes('role="alert"'));
    assert(core.includes('.main-header .bt-file-filter-rule'));
    assert(core.includes('.main-header .bt-file-filter-error'));
    assert(mobileBreakpoint >= 0);
    assert(index.includes('class="bt-file-filter-group"'));
    assert(mobileGroupRuleStart > mobileBreakpoint);
    assert(mobileGroupRule.includes('flex-basis: 100%;'));
    assert(mobileGroupRule.includes('justify-content: flex-start;'));
    assert(!mobileGroupRule.includes('padding: 4px 6px 7px 37px;'));
    assert(core.includes('.bt-file-filter-group.has-filter-rule .bt-file-filter-status'));
    assert(core.includes('min-height: 38px;'));
    assert(mobileRule > mobileBreakpoint);
    assert(core.indexOf('flex-wrap: wrap;', mobileRule) > mobileRule);
    assert(core.indexOf('max-width: 100%;', mobileRule) > mobileRule);
    assert(light.includes('.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled'));
    assert(light.includes('.skin-aria-ng .main-header .bt-file-filter-rule.has-error'));
    assert(dark.includes('.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.is-enabled'));
    assert(dark.includes('.theme-dark.skin-aria-ng .main-header .bt-file-filter-rule.has-error'));
});

test('keeps the operable disabled BT filter text at accessible contrast', function () {
    const light = read('src/styles/theme/default.css');
    const rule = light.match(/\.skin-aria-ng \.main-header \.bt-file-filter-rule \{([^}]+)\}/);

    assert(rule);

    const color = rule[1].match(/color:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
    const background = rule[1].match(/background-color:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
    const luminance = function (hex) {
        const channels = [1, 3, 5].map(function (offset) {
            const value = parseInt(hex.substr(offset, 2), 16) / 255;
            return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });

        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foregroundLuminance = luminance(color);
    const backgroundLuminance = luminance(background);
    const contrast = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

    assert(contrast >= 4.5, 'disabled operable filter contrast was ' + contrast.toFixed(2) + ':1');
    assert.strictEqual(color, '#687078');
    assert.strictEqual(background, '#f3f4f5');
});

test('keeps fixed content below a dynamically wrapping mobile header', function () {
    const fixScript = read('src/scripts/core/__fix.js');

    assert(fixScript.includes('header.outerHeight()'));
    assert(fixScript.includes("document.querySelector('.main-header .navbar-toolbar > .navbar-nav')"));
    assert(fixScript.includes('toolbar.getBoundingClientRect().bottom'));
    assert(fixScript.includes("css('padding-top', headerHeight)"));
    assert(fixScript.includes('window.ResizeObserver'));
    assert(!fixScript.includes('setInterval'));
});

let failed = 0;

tests.forEach(function (item) {
    try {
        item.fn();
        console.log('PASS ' + item.name);
    } catch (error) {
        failed++;
        console.error('FAIL ' + item.name);
        console.error(error.stack || error.message);
    }
});

if (failed > 0) {
    console.error(failed + ' test(s) failed');
    process.exit(1);
}

console.log(tests.length + ' test(s) passed');
