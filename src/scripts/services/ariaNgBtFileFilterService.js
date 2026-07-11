(function () {
    'use strict';

    angular.module('ariaNg').factory('ariaNgBtFileFilterService', ['$interval', '$timeout', 'ariaNgConstants', 'ariaNgStorageService', 'ariaNgSettingService', 'ariaNgNotificationService', 'ariaNgLogService', 'aria2TaskService', function ($interval, $timeout, ariaNgConstants, ariaNgStorageService, ariaNgSettingService, ariaNgNotificationService, ariaNgLogService, aria2TaskService) {
        var storageKey = ariaNgConstants.btFileFilterQueueStorageKey;
        var jobs = ariaNgStorageService.get(storageKey) || [];
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
        var warningNotified = false;
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

            return {
                mode: selectedIndexes.length > 0 && selectedIndexes.length < allIndexes.length ? 'filter' : 'full',
                selectedIndexes: selectedIndexes,
                allIndexes: allIndexes
            };
        };

        var saveJobs = function () {
            ariaNgStorageService.set(storageKey, jobs);
        };

        var getCurrentRpcIdentity = function () {
            return ariaNgSettingService.getCurrentRpcIdentity();
        };

        var getCurrentJobs = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            var currentJobs = [];

            for (var i = 0; i < jobs.length; i++) {
                if (jobs[i].rpcIdentity === rpcIdentity) {
                    currentJobs.push(jobs[i]);
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

        var resetAggregate = function (total) {
            pollCursor = 0;
            aggregate.total = total;
            aggregate.processed = 0;
            aggregate.filtered = 0;
            aggregate.full = 0;
            aggregate.fallback = 0;
            warningNotified = false;
        };

        var synchronizeRpcIdentity = function () {
            var rpcIdentity = getCurrentRpcIdentity();
            if (activeRpcIdentity === rpcIdentity) {
                return false;
            }

            activeRpcIdentity = rpcIdentity;
            var currentJobCount = getCurrentJobs().length;
            resetAggregate(currentJobCount);
            if (currentJobCount < 1) {
                setIdleStatus();
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

        var isNotFoundResponse = function (response) {
            var message = response && response.data && response.data.message;
            return /gid.*not found|no such download.*gid/i.test(String(message || ''));
        };

        var isSuccessfulResponse = function (response) {
            return !!(response && (response.success || response.hasSuccess));
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
            if (!warningNotified) {
                warningNotified = true;
                ariaNgNotificationService.notifyInPage('', 'format.bt-file-filter.fallback', {type: 'warning'});
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
        };

        var completeJob = function (job, outcome, rpcIdentity) {
            if (!isJobOnCurrentRpc(job, rpcIdentity)) {
                finishTick();
                return;
            }

            removeJob(job);
            aggregate.processed++;
            aggregate[outcome]++;

            if (outcome === 'fallback') {
                notifyFallback();
            }

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
                if (job.restoreAttempted && sameIndexes(task.files, allIndexes) &&
                    getOptionValue(currentOptions, 'bt-remove-unselected-file', 'false') === job.originalRemoveUnselectedFile) {
                    startOrComplete(job, task.gid, 'fallback', rpcIdentity);
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
                        startOrComplete(job, task.gid, 'fallback', rpcIdentity);
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
            } else {
                startOrComplete(job, task.gid, 'full', rpcIdentity);
            }
        };

        var recoverMetadataChild = function (job, rpcIdentity) {
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
                        childGidsByRoot[waitingTasks[i].following] = waitingTasks[i].gid;
                    }
                }

                var currentJobs = getCurrentJobs();
                var recoveredCurrentJob = false;
                var recoveredAnyJob = false;
                for (var j = 0; j < currentJobs.length; j++) {
                    var currentJob = currentJobs[j];
                    var childGid = childGidsByRoot[currentJob.rootGid];
                    if (!currentJob.childGid && childGid) {
                        currentJob.childGid = childGid;
                        currentJob.stage = 'waiting-files';
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

                removeDeletedJob(job, rpcIdentity);
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
                        recoverMetadataChild(job, rpcIdentity);
                    } else {
                        removeDeletedJob(job, rpcIdentity);
                    }
                } else {
                    finishTick();
                }
                return;
            }

            var task = response.data;
            if (job.stage.indexOf('starting-') === 0) {
                processStartingJob(job, task, rpcIdentity);
            } else if (task.bittorrent && task.files && task.files.length > 0) {
                processBtTask(job, task, rpcIdentity);
            } else if (task.followedBy && task.followedBy.length > 0) {
                job.childGid = task.followedBy[0];
                job.stage = 'waiting-files';
                touchAndSave(job);
                finishTick();
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
            jobs.push({
                rpcIdentity: rpcIdentity,
                rootGid: rootGid,
                childGid: '',
                thresholdBytes: intent.thresholdBytes,
                startAfterFilter: intent.startAfterFilter,
                sourceType: intent.sourceType,
                stage: 'waiting-metadata',
                retryCount: 0,
                originalRemoveUnselectedFile: null,
                createdAt: timestamp,
                updatedAt: timestamp
            });
            saveJobs();

            if (pollingPromise) {
                if (currentCount < 1) {
                    resetAggregate(1);
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
            resetAggregate(currentJobs.length);
            if (currentJobs.length > 0) {
                if (restoredQueue) {
                    setVisibleStatus('resuming', 'format.bt-file-filter.resuming', {count: currentJobs.length});
                } else {
                    updateActiveStatus();
                }
            }
            restoredQueue = false;
            pollingPromise = $interval(tick, 1000);
            return pollingPromise;
        };

        return {
            isBtMetadataUrl: isBtMetadataUrl,
            planFiles: planFiles,
            enqueue: enqueue,
            getJobs: function () {
                return jobs;
            },
            getStatus: function () {
                return status;
            },
            start: start
        };
    }]);
}());
