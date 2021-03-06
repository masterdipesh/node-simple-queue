var async = require('async');

function MongoDB(db_config) {
    var mongoose = require('mongoose');
    mongoose.set('debug', false);
    var mongoose_obj = {};

    function ConnectToDB() {
        if (db_config == undefined) {
            console.log('Mongo connect');
            //mongoose_obj = mongoose.createConnection('mongodb://127.0.0.1/node-queue');
            mongoose_obj = mongoose.createConnection('mongodb://localhost:27017/node-queue');
        } else {
            mongoose_obj = mongoose.createConnection('mongodb://' + db_config.username + ':' + db_config.password + '@' + db_config.host + ':' + db_config.port + '/' + db_config.db_name);
        }
    }

    ConnectToDB();

    /* JOBS Schema */
    var Schema = mongoose.Schema
        , ObjectId = Schema.ObjectId;

    var JobSchema = new Schema({
        CLASS_NAME: {type: String}
        , STATUS: {type: String}
        , QUEUE: {type: String}
        , PARAMS: {type: Schema.Types.Mixed}
        , HANDLE_BY: {type: Number}
        , ERROR: {type: Schema.Types.Mixed}
        , TIMESTAMP: {type: Number}
        , SUT: {type: Number}
    });
    mongoose_obj.model('Jobs', JobSchema);
    var Job = mongoose_obj.models.Jobs;

    Job.enqueueJob = function (queue_name, job, params, callback) {
        var job_obj = new Job();
        job_obj.CLASS_NAME = job;
        job_obj.QUEUE = queue_name;
        job_obj.PARAMS = params;
        job_obj.STATUS = 'Q';
        job_obj.HANDLE_BY = 0;
        job_obj.TIMESTAMP = (new Date().getTime());
        // console.log('Job etails : ' + JSON.stringify(job_obj));
        job_obj.save(function (err, res) {
            callback(err, res);
        });
    };


    Job.getNextJobsToDo = function (queue, pid, jobcallback) {
        // console.log('priorityQueueNames  : ' + priorityQueueNames);

        // If priority is not set then process queue in FIFO mechanism
        if (!priorityQueueNames.length) {
            findJob(queue, pid, function (err, job) {
                jobcallback(err, job);
            });
        } else {
            //(E.g  priorityQueue =["Queue1:153","Queue3:67","Queue2:0"])
            //(E.g  priorityQueueNames : ["Queue1","Queue3","Queue2"])
            // Find highest priority queue job and process,  if job not found then check for second highest priority queue job and so on
            async.forEachLimit(priorityQueueNames, 1, function (queueName, callback) {
                Job.find({$and: [{STATUS: 'Q'}, {QUEUE: queueName}]}).count(function (err, count) {
                    // if any priority job of queue found the pass queue name to process
                    if (count > 0) {
                        return callback({queue: queueName});
                    }
                    callback();
                });
            }, function (result) {
                if (result) {
                    // Process priority queue
                    findJob(result.queue, pid, function (err, job) {
                        jobcallback(err, job);
                    });
                } else {
                    console.log('No job to process');
                    jobcallback(null, false);
                }
            })
        }
    };


    function findJob(queue, pid, callback) {

        var condition;

        // If queue=* then process job in FIFO mechanism
        if (queue == "*") {
            condition = {STATUS: 'Q'};
        }
        else {
            // condition = {$and:[{STATUS:'Q'}, {QUEUE:queue}]};
            // condition = {$and: [{STATUS: 'Q'}, {QUEUE: {$in: queue.split(',')}}]};
            // If priority is not set then find job from given queue
            if (!priorityQueueNames.length) {
                condition = {$and: [{STATUS: 'Q'}, {QUEUE: {$in: queue.split(',')}}]};
            } else {
                // find job of priority queue
                condition = {$and: [{STATUS: 'Q'}, {QUEUE: queue}]};
            }
        }


        // console.log('Processing Queue ........Condition : ' + JSON.stringify(condition));
        Job.findOneAndUpdate(condition, {
            $set: {
                STATUS: 'P',
                HANDLE_BY: pid,
                SUT: Math.round(new Date().getTime() / 1000)
            }
        }, {sort: "TIMESTAMP"}, function (err, job) {
            if (err)
                callback(err);
            else if (job != null)
                callback(null, job);
            else
                callback(null, false);
        });
    }


    Job.retry = function (job_id, callback) {
        var ObjectId = mongoose.Types.ObjectId(job_id);
        Job.update({
            "_id": ObjectId
        }, {$set: {STATUS: 'Q', SUT: null}}, function (err, resp) {
            callback(err, resp);
        });
    };
    Job.removeJob = function (job_id, callback) {
        var ObjectId = mongoose.Types.ObjectId(job_id);
        Job.remove({
            "_id": ObjectId
        }, function (err, resp) {
            callback(err, resp);
        });
    };
    Job.getStuckedJobs = function (JOB_TIMEOUT, callback) {
        var currTimeStamp = Math.round(new Date().getTime() / 1000 - (JOB_TIMEOUT / 1000), 0);
        Job.find({STATUS: 'P', SUT: {$lte: currTimeStamp}}, callback);
    };

    this.Job = Job;

    /* WORKERS SCHEMA */
    var WorkerSchema = new Schema({
        PID: {type: String}
        , STATUS: {type: String}
        , QUEUE: {type: String}
        , PRIORITY: {type: Number}
    });
    mongoose_obj.model('Worker', WorkerSchema);
    var Worker = mongoose_obj.models.Worker;
    Worker.addNewWorker = function (pid, status, queue) {
        var worker = new Worker();
        worker.PID = pid;
        worker.STATUS = 'F';
        worker.QUEUE = queue;
        //worker.PRIORITY = priority;
        worker.save(function (err, result) {
        });
    };

    Worker.getFreeWorker = function (queue, callback) {
        if (queue != "*")
            condition = {$and: {STATUS: 'F', QUEUE: queue}};
        else
            condition = {STATUS: 'F'};
        Worker.find(condition, function (err, data) {
            if (err) {
                callback(err);
                return;
            }
            callback(null, data);
        });
    };
    Worker.MarkBusy = function (pid, callback) {
        Worker.update({PID: pid}, {$set: {STATUS: 'B'}}, callback);
    };

    Worker.MarkFree = function (pid, callback) {
        Worker.update({PID: pid}, {$set: {STATUS: 'F'}}, callback);
    };
    Worker.ReplaceWorker = function (pid, new_pid, callback) {
        Job.update({$and: [{HANDLE_BY: pid}, {STATUS: 'P'}]}, {$set: {STATUS: 'Q', HANDLE_BY: 0}}, function (err, res) {
        });
        Worker.update({PID: pid}, {$set: {PID: new_pid, STATUS: 'F'}}, callback);
    };
    Worker.RemoveWorker = function (queue) {
        Worker.remove({QUEUE: queue}, function (err, result) {
        });
    };
    Worker.RemoveWorkerByPID = function (PID, callback) {
        Worker.remove({PID: PID}, function (err, result) {
            callback();
        });
    };
    Worker.RemoveWorkerById = function (worker_id, callback) {
        Worker.remove({PID: worker_id}, function (err, result) {
            Job.update({$and: [{HANDLE_BY: worker_id}, {STATUS: 'P'}]}, {
                $set: {
                    STATUS: 'Q',
                    HANDLE_BY: 0
                }
            }, function (err, res) {
                callback(err, result);
            });
        });
    };
    this.Worker = Worker;
}
exports.MongoDB = MongoDB;
