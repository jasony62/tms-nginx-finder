//
function var_redis_key_upload_start_time(r) {
  return process.env.REDIS_KEY_UPLOAD_START_TIME;
}
//
function var_redis_key_upload_counter(r) {
  return process.env.REDIS_KEY_UPLOAD_COUNTER;
}
//
function var_redis_channel_upload(r) {
  return process.env.REDIS_CHANNEL_UPLOAD;
}

// 修改上传文件的名称
function renameFile(oFileData) {
  var ext = oFileData.name.match(/\w+$/)[0];
  var newpath = oFileData.path.replace(/\w+$/, oFileData.id) + "." + ext;
  var fs = require("fs");
  fs.renameSync(oFileData.path, newpath);

  oFileData.path = newpath;

  // 如果指定了日志文件，记录日志
  if (process.env.LOCAL_UPLOAD_LOG) {
    fs.appendFileSync(
      process.env.LOCAL_UPLOAD_LOG,
      JSON.stringify(oFileData) + "\r\n"
    );
  }

  return newpath;
}

// 给消息队列发消息
function publishToRedis(r, oFileData, callback) {
  var args = `message=` + encodeURIComponent(JSON.stringify(oFileData));
  r.subrequest(
    "/redis/publish",
    {
      method: "GET",
      args: args
    },
    callback
  );
}

// 解析Redis返回的数据
function parseRedisCounterResponse(res) {
  var lines = res.responseBody.split("\r\n");
  var bootAt = lines[1];
  var counter = lines[2].substr(1);
  var uploadId = `${bootAt}_${counter}`;

  return uploadId;
}

// 解析http请求数据
function RequestBody(r) {
  function parseOne(part, r) {
    var patt = /\r\n(.+?)\r\n\r\n(.+?)\r\n/g;
    var matches = patt.exec(part);
    if (matches && matches.length === 3) {
      var field = matches[1];
      field = /name="(.+?)"/.exec(field);
      if (field && field.length === 2) {
        field = field[1].split(".")[1];
        var value = matches[2];
        return [field, value];
      }
    }

    return false;
  }

  function parse(r) {
    var oFormData = {};
    var contentType = r.headersIn["Content-Type"];
    contentType = contentType.split(";");
    var boundary = contentType[1].split("=")[1];
    var formData = r.requestBody.split(`--${boundary}`);
    formData.forEach(part => {
      var pair = parseOne(part, r);
      if (pair && pair.length === 2) oFormData[pair[0]] = pair[1];
    });
    return oFormData;
  }

  this.data = parse(r);
}

function handle(r) {
  var reqBody = new RequestBody(r);
  var oFileData = reqBody.data; // 上传文件描述信息
  r.subrequest("/redis/counter", { method: "GET" }, function(res) {
    // 通过Redis获得文件id
    oFileData.id = parseRedisCounterResponse(res);
    // 更新文件的名称
    renameFile(oFileData);
    // 给消息队列发消息
    publishToRedis(r, oFileData, function(res) {
      r.headersOut["Content-Type"] = "application/json; charset=utf-8";
      r.return(200, JSON.stringify(oFileData));
    });
  });
}
