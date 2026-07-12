(function () {
    'use strict';

    angular.module('ariaNg').factory('ariaNgBtFileFilterService', ['$interval', '$timeout', 'ariaNgConstants', 'ariaNgStorageService', 'ariaNgSettingService', 'ariaNgNotificationService', 'ariaNgLogService', 'aria2TaskService', function ($interval, $timeout, ariaNgConstants, ariaNgStorageService, ariaNgSettingService, ariaNgNotificationService, ariaNgLogService, aria2TaskService) {
        var storageKey = ariaNgConstants.btFileFilterQueueStorageKey;
        var storedJobs = ariaNgStorageService.get(storageKey);
        var allowedSourceTypes = ['magnet', 'remote-torrent', 'torrent'];
        var allowedStages = [
            'waiting-metadata', 'waiting-files', 'applying-filter', 'restoring-full',
            'starting-filtered', 'starting-full', 'starting-fallback',
            'completed-filtered', 'completed-full', 'completed-fallback'
        ];
        var missingRootScanLimit = 3;
        var pollingInterval = 250;

        var normalizeInteger = function (value, defaultValue) {
            var number = Number(value);
            return isFinite(number) && number >= 0 ? Math.floor(number) : defaultValue;
        };

        var normalizeIndexes = function (value) {
            if (!Array.isArray(value)) {
                return [];
            }

            var indexes = [];
            for (var i = 0; i < value.length; i++) {
                var index = Number(value[i]);
                if (isFinite(index) && index > 0 && index === Math.floor(index) && indexes.indexOf(index) < 0) {
                    indexes.push(index);
                }
            }
            return indexes;
        };

        var normalizeBoolean = function (value) {
            if (value === true || value === 'true' || value === 1 || value === '1') {
                return true;
            }
            if (value === false || value === 'false' || value === 0 || value === '0') {
                return false;
            }
            return null;
        };

        var sanitizeJob = function (job) {
            if (!job || typeof job !== 'object' || Array.isArray(job)) {
                return null;
            }

            var rpcIdentity = typeof job.rpcIdentity === 'string' ? job.rpcIdentity.trim() : '';
            var rootGid = typeof job.rootGid === 'string' ? job.rootGid.trim() : '';
            var thresholdBytes = Number(job.thresholdBytes);
            var startAfterFilter = normalizeBoolean(job.startAfterFilter);
            if (!rpcIdentity || !rootGid || !isFinite(thresholdBytes) || thresholdBytes <= 0 ||
                startAfterFilter === null || allowedSourceTypes.indexOf(job.sourceType) < 0 ||
                allowedStages.indexOf(job.stage) < 0) {
                return null;
            }

            var timestamp = Date.now();
            var createdAt = Number(job.createdAt);
            var updatedAt = Number(job.updatedAt);
            var sanitized = {
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: typeof job.childGid === 'string' ? job.childGid.trim() : '',
                thresholdBytes: thresholdBytes,
                startAfterFilter: startAfterFilter,
                sourceType: job.sourceType,
                stage: job.stage,
                retryCount: normalizeInteger(job.retryCount, 0),
                originalRemoveUnselectedFile: job.originalRemoveUnselectedFile === null ||
                    typeof job.originalRemoveUnselectedFile === 'undefined' ? null :
                    String(job.originalRemoveUnselectedFile),
                createdAt: isFinite(createdAt) && createdAt > 0 ? createdAt : timestamp,
                updatedAt: isFinite(updatedAt) && updatedAt > 0 ? updatedAt : timestamp,
                missingRootScanCount: normalizeInteger(job.missingRootScanCount, 0),
                terminalChildScanCount: normalizeInteger(job.terminalChildScanCount, 0)
            };

            var selectedIndexes = normalizeIndexes(job.selectedIndexes);
            var allIndexes = normalizeIndexes(job.allIndexes);
            if (selectedIndexes.length > 0) {
                sanitized.selectedIndexes = selectedIndexes;
            }
            if (allIndexes.length > 0) {
                sanitized.allIndexes = allIndexes;
            }
            if (job.restoreAttempted) {
                sanitized.restoreAttempted = true;
            }
            if (job.restorationOutcome === 'full' || job.restorationOutcome === 'fallback') {
                sanitized.restorationOutcome = job.restorationOutcome;
            } else if (job.stage === 'restoring-full') {
                sanitized.restorationOutcome = 'fallback';
            }

            return sanitized;
        };

        var sanitizeQueue = function (value) {
            var sanitized = [];
            if (!Array.isArray(value)) {
                return sanitized;
            }
            for (var i = 0; i < value.length; i++) {
                var job = sanitizeJob(value[i]);
                if (job) {
                    sanitized.push(job);
                }
            }
            return sanitized;
        };

        var jobs = sanitizeQueue(storedJobs);
        var serializedStoredJobs;
        var serializedJobs = JSON.stringify(jobs);
        try {
            serializedStoredJobs = JSON.stringify(storedJobs);
        } catch (error) {
            serializedStoredJobs = null;
        }
        if (serializedStoredJobs !== serializedJobs) {
            ariaNgStorageService.set(storageKey, jobs);
        }
        var status = {
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
        };
        var pollingPromise = null;
        var tickInProgress = false;
        var restoredQueue = jobs.length > 0;
        var activeRpcIdentity = null;
        var pollCursor = 0;
        var statusVersion = 0;
        var aggregate = {
            total: 0,
            processed: 0,
            filtered: 0,
            full: 0,
            fallback: 0
        };

        var isBtMetadataUrl = function (url) {
            var normalized = String(url || '').trim();
            if (/^magnet:\?/i.test(normalized)) {
                return true;
            }

            var urlWithoutQueryOrFragment = normalized.split(/[?#]/)[0];
            return /^https?:\/\/[^/?#]+\/.*\.torrent$/i.test(urlWithoutQueryOrFragment);
        };

        var planFiles = function (files, thresholdBytes) {
            var selectedIndexes = [];
            var allIndexes = [];

            for (var i = 0; i < files.length; i++) {
                var index = parseInt(files[i].index);
                var length = parseInt(files[i].length);
                allIndexes.push(index);
                if (length >= thresholdBytes) {
                    selectedIndexes.push(index);
                }
            }

            var mode = 'filter';
            if (selectedIndexes.length < 1) {
                mode = 'all-small';
            } else if (selectedIndexes.length === allIndexes.length) {
                mode = 'all-large';
            }

            return {
                mode: mode,
                selectedIndexes: selectedIndexes,
                allIndexes: allIndexes
            };
        };

        var saveJobs = function () {
            ariaNgStorageService.set(storageKey, jobs);
        };

        var isTerminalJob = function (job) {
            return job.stage.indexOf('completed-') === 0;
        };

        var getCurrentRpcIdentity = function () {
            return ariaNgSettingService.getCurrentRpcIdentity();
        };

        var getCurrentRecords = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var currentRecords = [];

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity) {
                    currentRecords.push(jobs[i]);
                }
            }

            return currentRecords;
        };

        var getCurrentJobs = function () {
            var currentRecords = getCurrentRecords();
            var currentJobs = [];

            for (var i = 0; i < currentRecords.length; i++) {
                if (!isTerminalJob(currentRecords[i])) {
                    currentJobs.push(currentRecords[i]);
                }
            }

            return currentJobs;
        };

        var updateStatusValues = function () {
            var currentJobs = getCurrentJobs();
            var waiting = 0;

            for (var i = 0; i < currentJobs.length; i++) {
                if (currentJobs[i].stage === 'waiting-metadata' || currentJobs[i].stage === 'waiting-files') {
                    waiting++;
                }
            }

            status.total = aggregate.total;
            status.processed = aggregate.processed;
            status.waiting = waiting;
            status.filtered = aggregate.filtered;
            status.full = aggregate.full;
            status.fallback = aggregate.fallback;
        };

        var setVisibleStatus = function (type, textKey, textParams) {
            statusVersion++;
            status.visible = true;
            status.type = type;
            status.textKey = textKey;
            status.textParams = textParams;
            updateStatusValues();
        };

        var setIdleStatus = function () {
            statusVersion++;
            status.visible = false;
            status.type = 'idle';
            status.textKey = '';
            status.textParams = {};
            updateStatusValues();
        };

        var autoHideStatus = function (delay) {
            var version = statusVersion;
            $timeout(function () {
                if (version === statusVersion) {
                    status.visible = false;
                }
            }, delay);
        };

        var updateActiveStatus = function () {
            var currentJobs = getCurrentJobs();
            if (currentJobs.length < 1) {
                return;
            }

            var waiting = 0;
            for (var i = 0; i < currentJobs.length; i++) {
                if (currentJobs[i].stage === 'waiting-metadata' || currentJobs[i].stage === 'waiting-files') {
                    waiting++;
                }
            }

            if (waiting === currentJobs.length) {
                setVisibleStatus('waiting', 'format.bt-file-filter.waiting', {count: waiting});
            } else {
                setVisibleStatus('processing', 'format.bt-file-filter.processing', {
                    processed: aggregate.processed,
                    total: aggregate.total
                });
            }
        };

        var resetAggregate = function () {
            var currentRecords = getCurrentRecords();
            pollCursor = 0;
            aggregate.total = currentRecords.length;
            aggregate.processed = 0;
            aggregate.filtered = 0;
            aggregate.full = 0;
            aggregate.fallback = 0;

            for (var i = 0; i < currentRecords.length; i++) {
                if (isTerminalJob(currentRecords[i])) {
                    var outcome = currentRecords[i].stage.substring('completed-'.length);
                    aggregate.processed++;
                    aggregate[outcome]++;
                }
            }
        };

        var synchronizeRpcIdentity = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            if (activeRpcIdentity === rpcIdentity) {
                return false;
            }

            activeRpcIdentity = rpcIdentity;
            resetAggregate();
            var currentJobCount = getCurrentJobs().length;
            if (currentJobCount < 1) {
                if (aggregate.processed > 0) {
                    showOutcomeSummary();
                } else {
                    setIdleStatus();
                }
            }
            return true;
        };

        var isJobOnCurrentRpc = function (job, rpcIdentity) {
            return job.rpcIdentity === rpcIdentity && getCurrentRpcIdentity() === rpcIdentity && jobs.indexOf(job) >= 0;
        };

        var getOptionValue = function (options, key, defaultValue) {
            return typeof options[key] === 'undefined' ? defaultValue : String(options[key]);
        };

        var touchAndSave = function (job) {
            job.updatedAt = Date.now();
            saveJobs();
        };

        var removeJob = function (job) {
            var index = jobs.indexOf(job);
            if (index >= 0) {
                jobs.splice(index, 1);
                saveJobs();
            }
        };

        var responseHasSuccess = function (response) {
            return !!(response && (response.success || response.hasSuccess));
        };

        var isNotFoundResponse = function (response) {
            if (responseHasSuccess(response)) {
                return false;
            }

            var message = response && response.data && response.data.message;
            if (/gid.*not found|no such download.*gid/i.test(String(message || ''))) {
                return true;
            }

            var results = response && response.results;
            if (!Array.isArray(results)) {
                return false;
            }
            for (var i = 0; i < results.length; i++) {
                if (!responseHasSuccess(results[i])) {
                    var resultMessage = results[i] && results[i].data && results[i].data.message;
                    if (/gid.*not found|no such download.*gid/i.test(String(resultMessage || ''))) {
                        return true;
                    }
                }
            }
            return false;
        };

        var isSuccessfulResponse = function (response) {
            return responseHasSuccess(response);
        };

        var sameIndexes = function (files, indexes) {
            var selected = [];
            for (var i = 0; i < files.length; i++) {
                if (String(files[i].selected) === 'true') {
                    selected.push(parseInt(files[i].index));
                }
            }

            if (selected.length !== indexes.length) {
                return false;
            }

            selected.sort(function (a, b) { return a - b; });
            var expected = indexes.slice().sort(function (a, b) { return a - b; });
            for (var j = 0; j < expected.length; j++) {
                if (selected[j] !== expected[j]) {
                    return false;
                }
            }

            return true;
        };

        var finishTick = function () {
            tickInProgress = false;
            synchronizeRpcIdentity();
            if (getCurrentJobs().length > 0) {
                updateActiveStatus();
            }
        };

        var removeDeletedJob = function (job, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            removeJob(job);
            if (aggregate.total > aggregate.processed) {
                aggregate.total--;
            }
            if (getCurrentJobs().length < 1) {
                if (aggregate.processed > 0) {
                    showOutcomeSummary();
                } else {
                    setIdleStatus();
                }
            }
            finishTick();
        };

        var notifyFallback = function () {
            ariaNgNotificationService.notifyInPage('', 'format.bt-file-filter.fallback', {
                type: 'warning',
                contentParams: {count: aggregate.fallback}
            });
        };

        var clearCompletedOutcomes = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var changed = false;

            for (var i = jobs.length - 1; i >= 0; i--) {
                if (jobs[i].rpcIdentity === rpcIdentity && isTerminalJob(jobs[i])) {
                    jobs.splice(i, 1);
                    changed = true;
                }
            }
            if (changed) {
                saveJobs();
            }
        };

        var showOutcomeSummary = function () {
            if (aggregate.fallback > 0) {
                setVisibleStatus('warning', 'format.bt-file-filter.fallback', {count: aggregate.fallback});
                notifyFallback();
                autoHideStatus(10000);
            } else {
                setVisibleStatus('complete', 'format.bt-file-filter.complete', {
                    filtered: aggregate.filtered,
                    full: aggregate.full
                });
                autoHideStatus(5000);
            }
            clearCompletedOutcomes();
        };

        var completeJob = function (job, outcome, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            job.stage = 'completed-' + outcome;
            touchAndSave(job);
            aggregate.processed++;
            aggregate[outcome]++;

            if (getCurrentJobs().length < 1) {
                showOutcomeSummary();
            } else {
                updateActiveStatus();
            }
            finishTick();
        };

        var startOrComplete = function (job, gid, outcome, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            if (!job.startAfterFilter) {
                completeJob(job, outcome, rpcIdentity);
                return;
            }

            job.stage = 'starting-' + outcome;
            touchAndSave(job);
            aria2TaskService.startTasks([gid], function (response) {
                if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                    finishTick();
                    return;
                }

                if (isSuccessfulResponse(response)) {
                    completeJob(job, outcome, rpcIdentity);
                } else if (isNotFoundResponse(response)) {
                    removeDeletedJob(job, rpcIdentity);
                } else {
                    finishTick();
                }
            }, true);
        };

        var processStartingJob = function (job, task, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            var outcome = job.stage.substring('starting-'.length);
            if (task.status === 'removed') {
                removeDeletedJob(job, rpcIdentity);
                return;
            }
            if (task.status !== 'paused') {
                completeJob(job, outcome, rpcIdentity);
                return;
            }

            startOrComplete(job, task.gid, outcome, rpcIdentity);
        };

        var processRestoration = function (job, task, plan, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            var allIndexes = job.allIndexes || plan.allIndexes;
            var outcome = job.restorationOutcome || 'fallback';
            var fullSelection = allIndexes.join(',');
            aria2TaskService.getTaskOptions(task.gid, function (optionsResponse) {
                if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                    finishTick();
                    return;
                }

                if (!optionsResponse || !optionsResponse.success) {
                    if (isNotFoundResponse(optionsResponse)) {
                        removeDeletedJob(job, rpcIdentity);
                    } else {
                        finishTick();
                    }
                    return;
                }

                var currentOptions = optionsResponse.data || {};
                if (job.originalRemoveUnselectedFile === null || typeof job.originalRemoveUnselectedFile === 'undefined') {
                    job.originalRemoveUnselectedFile = getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false');
                }
                if (job.restoreAttempted && sameIndexes(task.files, allIndexes) &&
                    getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false') === job.originalRemoveUnselectedFile) {
                    startOrComplete(job, task.gid, outcome, rpcIdentity);
                    return;
                }

                job.restoreAttempted = true;
                touchAndSave(job);
                aria2TaskService.changeTaskOptions(task.gid, {
                    'select-file': fullSelection,
                    'bt-remove-unselected-file': job.originalRemoveUnselectedFile
                }, function (response) {
                    if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                        finishTick();
                        return;
                    }

                    if (response && response.success) {
                        startOrComplete(job, task.gid, outcome, rpcIdentity);
                    } else if (isNotFoundResponse(response)) {
                        removeDeletedJob(job, rpcIdentity);
                    } else {
                        finishTick();
                    }
                }, true);
            }, true);
        };

        var processMixedTask = function (job, task, plan, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            aria2TaskService.getTaskOptions(task.gid, function (optionsResponse) {
                if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                    finishTick();
                    return;
                }

                if (!optionsResponse || !optionsResponse.success) {
                    if (isNotFoundResponse(optionsResponse)) {
                        removeDeletedJob(job, rpcIdentity);
                    } else {
                        finishTick();
                    }
                    return;
                }

                var currentOptions = optionsResponse.data || {};
                if (job.originalRemoveUnselectedFile === null || typeof job.originalRemoveUnselectedFile === 'undefined') {
                    job.originalRemoveUnselectedFile = getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false');
                }
                job.selectedIndexes = plan.selectedIndexes;
                job.allIndexes = plan.allIndexes;

                if (job.stage === 'applying-filter' && sameIndexes(task.files, plan.selectedIndexes) &&
                    String(currentOptions['bt-remove-unselected-file']) === 'true') {
                    startOrComplete(job, task.gid, 'filtered', rpcIdentity);
                    return;
                }

                job.stage = 'applying-filter';
                touchAndSave(job);
                aria2TaskService.changeTaskOptions(task.gid, {
                    'select-file': plan.selectedIndexes.join(','),
                    'bt-remove-unselected-file': 'true'
                }, function (response) {
                    if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                        finishTick();
                        return;
                    }

                    if (response && response.success) {
                        startOrComplete(job, task.gid, 'filtered', rpcIdentity);
                    } else if (isNotFoundResponse(response)) {
                        removeDeletedJob(job, rpcIdentity);
                    } else {
                        job.retryCount++;
                        if (job.retryCount >= 3) {
                            job.stage = 'restoring-full';
                            job.restoreAttempted = false;
                            job.restorationOutcome = 'fallback';
                        }
                        touchAndSave(job);
                        finishTick();
                    }
                }, true);
            }, true);
        };

        var processBtTask = function (job, task, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            var plan = planFiles(task.files, job.thresholdBytes);
            if (job.stage === 'restoring-full') {
                processRestoration(job, task, plan, rpcIdentity);
            } else if (plan.mode === 'filter') {
                processMixedTask(job, task, plan, rpcIdentity);
            } else if (plan.mode === 'all-small' && !sameIndexes(task.files, plan.allIndexes)) {
                job.stage = 'restoring-full';
                job.restoreAttempted = false;
                job.restorationOutcome = 'full';
                job.allIndexes = plan.allIndexes;
                touchAndSave(job);
                processRestoration(job, task, plan, rpcIdentity);
            } else {
                startOrComplete(job, task.gid, 'full', rpcIdentity);
            }
        };

        var settleAbsentMetadataChild = function (job, rpcIdentity, terminalStatus) {
            removeDeletedJob(job, rpcIdentity);
        };

        var recoverMetadataChild = function (job, rpcIdentity, terminalStatus) {
            aria2TaskService.getTaskList('waiting', true, function (response) {
                if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                    finishTick();
                    return;
                }

                if (!response || !response.success) {
                    finishTick();
                    return;
                }

                var waitingTasks = response.data || [];
                var childGidsByRoot = {};
                for (var i = 0; i < waitingTasks.length; i++) {
                    if (waitingTasks[i].following) {
                        if (!childGidsByRoot[waitingTasks[i].following]) {
                            childGidsByRoot[waitingTasks[i].following] = [];
                        }
                        childGidsByRoot[waitingTasks[i].following].push(waitingTasks[i].gid);
                    }
                }

                var currentJobs = getCurrentJobs();
                var recoveredCurrentJob = false;
                var recoveredAnyJob = false;
                for (var j = 0; j < currentJobs.length; j++) {
                    var currentJob = currentJobs[j];
                    var childGids = childGidsByRoot[currentJob.rootGid] || [];
                    if (!currentJob.childGid && childGids.length === 1) {
                        currentJob.childGid = childGids[0];
                        currentJob.stage = 'waiting-files';
                        currentJob.missingRootScanCount = 0;
                        currentJob.terminalChildScanCount = 0;
                        currentJob.updatedAt = Date.now();
                        recoveredAnyJob = true;
                        recoveredCurrentJob = recoveredCurrentJob || currentJob === job;
                    }
                }

                if (recoveredAnyJob) {
                    saveJobs();
                }

                if (recoveredCurrentJob) {
                    finishTick();
                    return;
                }

                var currentChildGids = childGidsByRoot[job.rootGid] || [];
                if (currentChildGids.length > 1) {
                    job.missingRootScanCount = 0;
                    job.terminalChildScanCount = 0;
                    touchAndSave(job);
                    finishTick();
                    return;
                }

                var counter = terminalStatus ? 'terminalChildScanCount' : 'missingRootScanCount';
                job[counter] = normalizeInteger(job[counter], 0) + 1;
                if (job[counter] >= missingRootScanLimit) {
                    settleAbsentMetadataChild(job, rpcIdentity, terminalStatus);
                    return;
                }
                touchAndSave(job);

                finishTick();
            }, true, ['gid', 'following']);
        };

        var processTaskResponse = function (job, response, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            if (!response || !response.success) {
                if (isNotFoundResponse(response)) {
                    if (!job.childGid && (job.sourceType === 'magnet' || job.sourceType === 'remote-torrent')) {
                        recoverMetadataChild(job, rpcIdentity, null);
                    } else {
                        removeDeletedJob(job, rpcIdentity);
                    }
                } else {
                    finishTick();
                }
                return;
            }

            var task = response.data;
            if (job.missingRootScanCount) {
                job.missingRootScanCount = 0;
                touchAndSave(job);
            }
            if (job.stage.indexOf('starting-') === 0) {
                processStartingJob(job, task, rpcIdentity);
            } else if (task.bittorrent && task.files && task.files.length > 0) {
                processBtTask(job, task, rpcIdentity);
            } else if (task.followedBy && task.followedBy.length > 0) {
                job.childGid = task.followedBy[0];
                job.stage = 'waiting-files';
                job.terminalChildScanCount = 0;
                touchAndSave(job);
                finishTick();
            } else if (!job.childGid && (task.status === 'complete' || task.status === 'error' ||
                task.status === 'removed')) {
                recoverMetadataChild(job, rpcIdentity, task.status);
            } else {
                job.stage = 'waiting-metadata';
                touchAndSave(job);
                finishTick();
            }
        };

        var tick = function () {
            if (tickInProgress) {
                return;
            }

            synchronizeRpcIdentity();
            var currentJobs = getCurrentJobs();
            if (currentJobs.length < 1) {
                return;
            }

            tickInProgress = true;
            setVisibleStatus('processing', 'format.bt-file-filter.processing', {
                processed: aggregate.processed,
                total: aggregate.total
            });
            var job = currentJobs[pollCursor % currentJobs.length];
            pollCursor++;
            var rpcIdentity = getCurrentRpcIdentity();
            aria2TaskService.getTaskStatus(job.childGid || job.rootGid, function (response) {
                processTaskResponse(job, response, rpcIdentity);
            }, true);
        };

        var enqueue = function (rootGid, intent) {
            var rpcIdentity = getCurrentRpcIdentity();

            if (pollingPromise) {
                synchronizeRpcIdentity();
            }

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity && jobs[i].rootGid === rootGid) {
                    return;
                }
            }

            var timestamp = Date.now();
            var currentCount = getCurrentJobs().length;
            var job = sanitizeJob({
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: '',
                thresholdBytes: intent && intent.thresholdBytes,
                startAfterFilter: intent && intent.startAfterFilter,
                sourceType: intent && intent.sourceType,
                stage: 'waiting-metadata',
                retryCount: 0,
                originalRemoveUnselectedFile: null,
                missingRootScanCount: 0,
                terminalChildScanCount: 0,
                createdAt: timestamp,
                updatedAt: timestamp
            });
            if (!job) {
                return;
            }
            jobs.push(job);
            saveJobs();

            if (pollingPromise) {
                if (currentCount < 1) {
                    resetAggregate();
                } else {
                    aggregate.total++;
                }
                updateActiveStatus();
            }
        };

        var start = function () {
            if (pollingPromise) {
                return pollingPromise;
            }

            var currentJobs = getCurrentJobs();
            activeRpcIdentity = getCurrentRpcIdentity();
            resetAggregate();
            if (currentJobs.length > 0) {
                if (restoredQueue) {
                    setVisibleStatus('resuming', 'format.bt-file-filter.resuming', {count: currentJobs.length});
                } else {
                    updateActiveStatus();
                }
            } else if (aggregate.processed > 0) {
                showOutcomeSummary();
            }
            restoredQueue = false;
            pollingPromise = $interval(tick, pollingInterval);
            return pollingPromise;
        };

        return {
            isBtMetadataUrl: isBtMetadataUrl,
            planFiles: planFiles,
            enqueue: enqueue,
            getJobs: function () {
                return sanitizeQueue(jobs);
            },
            getStatus: function () {
                return status;
            },
            start: start
        };
    }]);
}());
