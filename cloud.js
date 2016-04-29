var AV = require('leanengine');
var Redis = require('redis');
var https = require('https');
var http = require('http');
var parse = require('url-parse');
var querystring = require('querystring');

var options = {
  host: 'hook.bearychat.com',
  port: 443,
  path: '/=bw52Y/incoming/8b047f7c00020d2d7595a54af3f0c326',
  method: 'POST',
  headers: {'Content-Type':'application/json'}
};

var RedisMonitorItem = AV.Object.extend('RedisMonitorItem');

/**
 * 一个简单的云代码方法
 */
AV.Cloud.define('hello', function(request, response) {
  send_notify('EyesOnKA', '云引擎', 'test message')
  response.success('Hello world!');
});

function send_sms_2person(mobile, appName, service, detailInfo) {
  AV.Cloud.requestSmsCode({
    mobilePhoneNumber: mobile,
    template: 'ka_alert',
    kaname:appName,
    servicename: service,
    detail:detailInfo
  }).then(function() {
    console.log('successed to send notify sms to jfeng');
  }, function(err) {
    console.error(err);
  });
}

function send_sms_notify(appName, service, detailInfo) {
  send_sms_2person('18600345198', appName, service, detailInfo);//jfeng
  send_sms_2person('15658580416', appName, service, detailInfo);//wchen
  send_sms_2person('18668012283', appName, service, detailInfo);//xzhuang
}

function send_notify(appName, service, detailInfo) {
  try {
    send_sms_notify(appName, service, detailInfo);
    send_bearychat_notify(appName, service, detailInfo);
  } catch (err) {
    console.error(err);
  }
}

function send_bearychat_notify(appName, service, msg) {
  var post_data = JSON.stringify({
    'text': appName + ' 的 ' + service + ' 服务出现故障，详情：' + msg,
  });
  var req = https.request(options, function(res) {
    console.log('\t  send notify to bearychat. response STATUS: ' + res.statusCode);
    res.setEncoding('utf8');
    res.on('data', function (chunk) {
    });
  });

  // write data to request body
  req.write(post_data + "\n");
  req.end();
}

var internal_monitor_key = "leancloud_internal_available_monitor_key";
var allowedMaxGap = 420;// 7 minitor, check interval: 5 min

AV.Cloud.define('redis_check_timer', function(req, res) {
  var currentTS = parseInt(new Date().getTime()/1000);//seconds

  var query = new AV.Query('RedisMonitorItem');
  query.equalTo('valid', true);
  query.find({
    success: function(results) {
      console.log('begin to check redis list. totalCount=', results.length);
      function checkRedisItem(i) {
        if (i < 0 || i >= results.length) {
          return;
        } else {
          var item = results[i];
          var redisHost = item.get('targetHost');
          var appName = item.get('appName');
          var appId = item.get('appId');
          var criticalKey = item.get('criticalKey');
          var instanceId = item.get('instanceId');
	  var engineUrl = item.get('engineEntranceUrl');
          var client = Redis.createClient(redisHost);
          console.log('  check item: appName=%s, targetRedis=%s, instanceId=%s, criticalKey=%s ...',
                       appName, redisHost, instanceId, criticalKey)
          if (engineUrl && engineUrl.length>0) {
	          var url = parse(engineUrl, true);
            http.get({
  	          host: url.host,
              path: url.pathname
	          }, function(response) {
	            if (response.statusCode >= 500) {
	              send_notify(appName, "LeanEngine", 'response status - ' + response.statusCode);
                console.error('    LEANENGINE error. appName:%s, instanceId:%s, statusCode: %s', appName, instanceId, response.statusCode);
 	            }
	          });
	        }
          client.on('error', function(err) {
            send_notify(appName, "LeanCache", "UNKNOWN error. instanceId:" + instanceId);
            console.error('    REDIS UNKNOWN error. appName:%s, instanceId:%s, causeBy: %s', appName, instanceId, err);
            client.end();
            setTimeout(checkRedisItem(i+1), 2000);
            return;
          });
          client.on('connect', function() {
            client.exists(criticalKey, function(err, reply) {
              if (err || reply < 1) {
                send_notify(appName, "LeanCache", "READ error. instanceId:" + instanceId + ', key:' + criticalKey);
                console.error('    REDIS READ error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err);
              } else {
                // do nothing.
              }
              // read internal monitor key
              client.get(internal_monitor_key, function(err, response){
                if (err || !response) {
                  send_notify(appName, "LeanCache", "internal Key not exist.");
                  console.error('    REDIS READ internal key error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err)
                } else if (parseInt(response) + allowedMaxGap < currentTS) {
                  send_notify(appName, "LeanCache", "Invalid internal Key. currentValue:" + response + ", delay:" + (currentTS-parseInt(response))/60 + ' mins');
                  console.warn('    REDIS Invalid internal key. appName:%s, instanceId:%s, value:%s', appName, instanceId, response)
                }
                // write new value to internal monitor key
                client.set(internal_monitor_key, currentTS, function(err){
                  if (err) {
                    send_notify(appName, "LeanCache", "WRITE internal key error. ");
                    console.error('   REDIS WRITE internal key error. appName:%s, instanceId:%s, causeBy:%s', appName, instanceId, err);
                  }
                  client.end();
                  setTimeout(checkRedisItem(i+1), 2000);
                });
              });
            })
          });
        }
      }
      checkRedisItem(0);
      res.success(results.length)
    },
    error: function(error) {
      console.error('Failed to query check item for redis service.');
      send_notify("EyesOnKA", "LeanCloud", "failed to exec query for monitor items");
      res.error('failed to exec query for monitor items');
    }
  });
});

module.exports = AV.Cloud;
