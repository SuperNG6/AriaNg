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
    let rpcIdentity = options.rpcIdentity || 'http|localhost|6800|jsonrpc';
    const tasks = options.tasks || {};
    const taskOptions = options.taskOptions || {};
    const intervals = [];
    const timeouts = [];
    const changedOptions = [];
    const startedGids = [];
    const notifications = [];
    const statusGids = [];
    const pendingStatusCallbacks = [];
    const pendingOptionCallbacks = [];
    const pendingChangeCallbacks = [];
    const pendingStartCallbacks = [];
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
        }
    });

    const dependencies = {
        '$interval': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            intervals.push(handle);
            return handle;
        },
        '$timeout': function (callback, delay) {
            const handle = {callback: callback, delay: delay};
            timeouts.push(handle);
            return handle;
        },
        'ariaNgConstants': constants.ariaNgConstants,
        'ariaNgStorageService': {
            get: function () { return savedQueue; },
            set: function (key, value) {
                assert.strictEqual(key, constants.ariaNgConstants.btFileFilterQueueStorageKey);
                savedQueue = value;
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
                const response = waitingListResponses.length > 0 ? waitingListResponses.shift() :
                    {success: true, data: options.waitingTasks || []};
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
                if ((response.success || applyFailedChange) && tasks[gid] && rpcOptions['select-file']) {
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
                if (options.deferStart) {
                    pendingStartCallbacks.push({callback: callback, response: response});
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
        notifications: notifications,
        statusGids: statusGids,
        optionRpcIdentities: optionRpcIdentities,
        changeRpcIdentities: changeRpcIdentities,
        startRpcIdentities: startRpcIdentities,
        waitingListRequests: waitingListRequests,
        intervals: intervals,
        timeouts: timeouts,
        setRpcIdentity: function (value) { rpcIdentity = value; },
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
        resolveWaitingList: function (response) {
            const pending = pendingWaitingListCallbacks.shift();
            pending.callback(response || pending.response);
        },
        getSavedQueue: function () { return savedQueue || []; },
        tick: function () {
            intervals.forEach(function (interval) { interval.callback(); });
        },
        tickUntilIdle: function () {
            for (let i = 0; i < 30 && service.getJobs().some(function (job) {
                return job.rpcIdentity === rpcIdentity;
            }); i++) {
                intervals.forEach(function (interval) { interval.callback(); });
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
            getKeyboardShortcuts: function () { return !!options.keyboardShortcuts; }
        },
        'ariaNgBtFileFilterService': filterService,
        'aria2TaskService': taskService,
        'aria2SettingService': {
            getNewTaskOptionKeys: function () { return []; },
            getSpecifiedOptions: function () { return {}; }
        }
    };
    const names = controllerDefinition.slice(0, -1);
    controllerDefinition[controllerDefinition.length - 1].apply(null, names.map(function (name) {
        return dependencies[name];
    }));
    scope.context.urls = options.urls || '';
    scope.context.options = options.taskOptions || {};
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
        respondTorrent: function (response) { torrentCallback(response); },
        respondMetalink: function (response) { metalinkCallback(response); }
    };
};

const loadMainController = function (options) {
    options = options || {};
    let controllerDefinition;
    let globalStatCallback;
    let startCount = 0;
    const status = {visible: false};
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
    const rootScope = {taskContext: {getSelectedTaskIds: function () { return []; }}};
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
            start: function () { startCount++; }
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
        respondGlobalStat: function (response) { globalStatCallback(response); },
        getStartCount: function () { return startCount; }
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
    assert.strictEqual(service.planFiles([{index: '1', length: '1'}], 100 * mb).mode, 'full');
    assert.strictEqual(service.planFiles([{index: '1', length: String(101 * mb)}], 100 * mb).mode, 'full');
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
            root: {gid: 'root', status: 'complete', followedBy: ['child']},
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
                JSON.stringify(['gid', 'following']);
    }));
    assert.deepStrictEqual(context.changedOptions.map(function (change) {
        return change.gid;
    }).sort(), ['child-1', 'child-2', 'child-3', 'child-4', 'child-5']);
    assert.deepStrictEqual(context.startedGids.slice().sort(),
        ['child-1', 'child-2', 'child-3', 'child-4', 'child-5']);
    assert.strictEqual(context.getSavedQueue().length, 0);
    assert.strictEqual(context.service.getStatus().filtered, 5);
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

test('all-small and all-large plans skip option changes and start Download Now', function () {
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

test('terminal remote torrent roots settle after a bounded child creation race', function () {
    ['complete', 'error', 'removed'].forEach(function (terminalStatus) {
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
        if (terminalStatus === 'complete') {
            assert.strictEqual(context.service.getStatus().full, 1);
        }
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
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root']);

    context.resolveStatus();
    context.tick();
    assert.deepStrictEqual(context.statusGids, ['root', 'root']);
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
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'waiting');
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

test('all-small and all-large partial selections restore full semantics and cleanup option', function () {
    const cases = [
        [{index: '1', length: '1', selected: 'false'}, {index: '2', length: '2', selected: 'true'}],
        [{index: '1', length: '200', selected: 'true'}, {index: '2', length: '300', selected: 'false'}]
    ];

    cases.forEach(function (files) {
        const context = loadFilterService({
            tasks: {task: {gid: 'task', status: 'paused', bittorrent: {}, files: files}},
            taskOptions: {'bt-remove-unselected-file': 'true'}
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
    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'waiting');
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

    assert.strictEqual(context.getSavedQueue().length, 1);
    assert.strictEqual(context.getSavedQueue()[0].rootGid, 'deleted');
    assert.strictEqual(context.service.getStatus().type, 'waiting');
    assert.strictEqual(context.service.getStatus().textKey, 'format.bt-file-filter.waiting');
    assert.strictEqual(context.service.getStatus().processed, 1);
    assert.strictEqual(context.service.getStatus().total, 2);
});

test('renders the remembered filter and global toolbar status', function () {
    const index = read('src/index.html');
    const styles = read('src/styles/core/core.css') +
        read('src/styles/theme/default.css') + read('src/styles/theme/default-dark.css');
    const language = read('src/scripts/config/defaultLanguage.js');

    assert(index.includes('class="bt-file-filter-toolbar" ng-if="isNewTaskPage()"'));
    assert(index.includes('ng-model="btFileFilterContext.enabled"'));
    assert(index.includes('ng-model="btFileFilterContext.minSizeMb"'));
    assert(index.includes('ng-change="saveBtFileFilterSetting()"'));
    assert(index.includes('bt-file-filter-status'));
    assert(index.includes('btFileFilterStatus.textKey | translate: btFileFilterStatus.textParams'));
    assert(index.includes('aria-invalid="{{btFileFilterContext.enabled && !isBtFileFilterValid()}}"'));
    assert(styles.includes('.bt-file-filter-toolbar'));
    assert(styles.includes('.bt-file-filter-status'));
    assert(styles.includes('.bt-file-filter-status-compact'));
    assert(styles.includes('@media (max-width: 767px)'));
    assert(language.includes("'Filter files smaller than'"));
    assert(language.includes("'format.bt-file-filter.resuming'"));
    assert(read('src/langs/zh_Hans.txt').includes('format.bt-file-filter.compact=过滤 {{count}}'));
    assert(read('src/langs/zh_Hant.txt').includes('format.bt-file-filter.compact=篩選 {{count}}'));
});

test('scopes tablet search hiding to active filter controls or status', function () {
    const index = read('src/index.html');
    const core = read('src/styles/core/core.css');
    const tabletBreakpoint = core.indexOf('@media (max-width: 1199px)');
    const globalSearchRule = '.main-header .navbar .navbar-searchbar {\n        display: none;\n    }';
    const scopedSearchRule = '.main-header .navbar.bt-file-filter-active .navbar-searchbar {';

    assert(index.includes("ng-class=\"{'bt-file-filter-active': isNewTaskPage() || btFileFilterStatus.visible}\""));
    assert(tabletBreakpoint >= 0);
    assert.strictEqual(core.indexOf(globalSearchRule, tabletBreakpoint), -1);
    assert(core.indexOf(scopedSearchRule, tabletBreakpoint) > tabletBreakpoint);
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

test('keeps the filter label compact and invalid borders themed', function () {
    const core = read('src/styles/core/core.css');
    const light = read('src/styles/theme/default.css');
    const dark = read('src/styles/theme/default-dark.css');
    const tabletBreakpoint = core.indexOf('@media (max-width: 1199px)');
    const tabletLabelRule = core.indexOf('.main-header .bt-file-filter-label {', tabletBreakpoint);
    const lightNeutral = light.indexOf('.skin-aria-ng .main-header .bt-file-filter-size {');
    const lightInvalid = light.indexOf('.skin-aria-ng .main-header .bt-file-filter-size.has-error {');
    const lightInvalidFocus = light.indexOf('.skin-aria-ng .main-header .bt-file-filter-size.has-error:focus {');
    const darkNeutral = dark.indexOf('.theme-dark.skin-aria-ng .main-header .bt-file-filter-size {');
    const darkInvalid = dark.indexOf('.theme-dark.skin-aria-ng .main-header .bt-file-filter-size.has-error {');
    const darkInvalidFocus = dark.indexOf('.theme-dark.skin-aria-ng .main-header .bt-file-filter-size.has-error:focus {');

    assert(tabletBreakpoint >= 0);
    assert(tabletLabelRule > tabletBreakpoint);
    assert(lightInvalid > lightNeutral);
    assert(lightInvalidFocus > lightInvalid);
    assert(darkInvalid > darkNeutral);
    assert(darkInvalidFocus > darkInvalid);
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
