'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const read = (path) => fs.readFileSync(path, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({name, fn});

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

test('defines the generic task-list preference with a false default', function () {
    const constants = loadConstants();

    assert.strictEqual(constants.ariaNgDefaultOptions.showFileListInTaskListPage, false);
    assert.strictEqual(constants.ariaNgDefaultOptions.showFileListInDownloadingPage, undefined);
});

test('migrates the previous downloading preference', function () {
    const context = loadSettingService({language: 'en', showFileListInDownloadingPage: true});

    assert.strictEqual(context.service.getShowFileListInTaskListPage(), true);
    assert.strictEqual(context.getSavedOptions().showFileListInTaskListPage, true);
});

test('prefers an existing generic preference over the legacy value', function () {
    const context = loadSettingService({
        language: 'en',
        showFileListInDownloadingPage: true,
        showFileListInTaskListPage: false
    });

    assert.strictEqual(context.service.getShowFileListInTaskListPage(), false);
});

test('persists the generic preference without changing the legacy value', function () {
    const context = loadSettingService({language: 'en', showFileListInDownloadingPage: false});

    context.service.setShowFileListInTaskListPage(true);

    assert.strictEqual(context.getSavedOptions().showFileListInTaskListPage, true);
    assert.strictEqual(context.getSavedOptions().showFileListInDownloadingPage, false);
});

test('exposes one toolbar toggle on all task-list routes', function () {
    const main = read('src/scripts/controllers/main.js');
    const index = read('src/index.html');

    assert(main.includes("location === 'downloading' || location === 'waiting' || location === 'stopped'"));
    assert(main.includes('$scope.isTaskListPage = function'));
    assert(main.includes('$scope.isTaskListFileListEnabled = function'));
    assert(main.includes('$scope.toggleTaskListFileList = function'));
    assert(main.includes("$rootScope.$broadcast('task-list-file-list-mode.changed'"));
    assert(index.includes('ng-if="isTaskListPage()"'));
    assert(index.includes('ng-click="toggleTaskListFileList()"'));
});

test('uses continuous full refreshes only for active downloads', function () {
    const list = read('src/scripts/controllers/list.js');

    assert(list.includes("showFileList && location === 'downloading'"));
    assert(list.includes('removeVirtualFileNodes($rootScope.taskContext.list);'));
    assert(list.includes("$scope.$on('task-list-file-list-mode.changed'"));
    assert(!list.includes("if (location !== 'downloading')"));
});

test('renders the generic nested panel with read-only file controls', function () {
    const view = read('src/views/list.html');
    const styles = [
        read('src/styles/controls/task-table.css'),
        read('src/styles/theme/default.css'),
        read('src/styles/theme/default-dark.css')
    ].join('\n');

    assert(view.includes('has-task-list-file-list'));
    assert(view.includes('task-list-file-list'));
    assert(view.includes('task-list-file-panel'));
    assert(view.includes('showTaskListFileList()'));
    assert(/task_list_node_[^\n]+type="checkbox" disabled/.test(view));
    assert(/task_list_file_[^\n]+type="checkbox" disabled/.test(view));
    assert(styles.includes('.task-list-file-panel'));
    assert(!styles.includes('downloading-file-panel'));
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
