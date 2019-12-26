> 习惯上只是简单把 Nginx 用作 WebServer，最近看了看它的插件，发现其实有很多玩法，特别是很多工作可以不再需要写代码了，通过安装配置插件就可以实现。本文以搭建一个文档服务器为例，演示一下怎样使用 Nginx 插件。

# 项目概述

本项目尝试用Nginx的多个模块搭建一个文档服务器，实现文件的上传和浏览。纯粹用Nginx实现是想讲文件上传作为一个独立的基础模块，如果其他业务模块需要文件管理功能，可以直接使用。

项目地址：https://github.com/jasony62/tms-nginx-finder

# 安装插件

| 名称                  | 功能                         | 指令             |
| --------------------- | ---------------------------- | ---------------- |
| echo-nginx-module     | 快速响应内容                 | echo             |
| nginx-upload-module   | 上传文件                     | upload_xxx       |
| njs                   | 用 Javascript 处理业务逻辑   | js_xxx           |
| set-misc-nginx-module | 在 nginx.conf 文件中处理变量 | set_unescape_uri |
| redis2-nginx-module   | redis 客户端                 | redis2_xxx       |

# 配置 Nginx

## 环境参数

| 环境变量                    | 参数名                        | 说明                                       |
| --------------------------- | ----------------------------- | ------------------------------------------ |
| REDIS_KEY_UPLOAD_START_TIME | \$redis_key_upload_start_time | Redis 中用于保存服务启动时间的 key         |
| REDIS_KEY_UPLOAD_COUNTER    | \$redis_key_upload_counter    | Redis 中用于保存上传文件次数的 key         |
| REDIS_CHANNEL_UPLOAD        | \$redis_channel_upload        | Redis 中接收上传文件信息的 channel         |
| LOCAL_UPLOAD_LOG            |                               | 本地保存上传文件日志，指定了记，不指定不记 |

需要在`nginx.conf`文件中添加如下设置，用`env`指令说明需要使用的环境变量，用`js_set`指令创建变量并赋值（没有找到直接在配置文件中使用环境变量的方法）。

```
env REDIS_KEY_UPLOAD_START_TIME;
env REDIS_KEY_UPLOAD_COUNTER;
env REDIS_CHANNEL_UPLOAD;
```

```
js_include /usr/local/nginx/njs/upload.js;
js_set $redis_key_upload_start_time var_redis_key_upload_start_time;
js_set $redis_key_upload_counter var_redis_key_upload_counter;
js_set $redis_channel_upload var_redis_channel_upload;
```

## 访问目录

我们希望可以通过 Nginx 直接访问某个目录下的文件，例如：nginx 工作目录下的 files 目录，在`nginx.conf`中添加如下内容：

```
location = /files/ {
  root .;
  autoindex on;
}
```

## 上传文件

我们用[nginx-upload-module](https://github.com/fdintino/nginx-upload-module)插件实现文件上传功能。安装完成后，在`nginx.conf`中添加如下配置：

```
location /upload/ {
  # 指定上传文件的存放位置
  upload_store /usr/local/nginx/files;

  # 设置转发的信息
  upload_set_form_field $upload_field_name.name "$upload_file_name";
  upload_set_form_field $upload_field_name.content_type "$upload_content_type";
  upload_set_form_field $upload_field_name.path "$upload_tmp_path";
  upload_aggregate_form_field "$upload_field_name.md5" "$upload_file_md5";
  upload_aggregate_form_field "$upload_field_name.size" "$upload_file_size";

  # 文件上传后转发请求
  upload_pass @upload_response;
  # add_header "Content-Type" "text/html; charset=UTF-8";
  # echo "echo: Upload done";
}
```

指令`upload_pass`是文件上传后将文件的基本信息转发到指定地址。接收上传文件信息的地址用的是命名地址（named location），它不是按照正则匹配的，用于内部转发（后面 njs 模块会说明如何实现）。

上传的文件会放在指令`upload_store`指定的位置，文件是由数字组成的递增的字符，例如：0000000001，0000000002。如果不需要后续处理，可以不用转发上传文件数据，直接通过`echo`指令返回结果。

## 处理文件

因为无法指定上传文件的命名（没有扩展名），而且每次重启 Nginx 都会从头开始给文件命名，可能会覆盖已有的文件，这样使用起来不方便，所以希望能够修改上传文件的名字。这里我们使用了[njs](http://nginx.org/en/docs/njs/)模块，在`nginx.conf`中添加如下配置：

```
js_include /usr/local/nginx/njs/upload.js;
```

```
location @upload_response {
  js_content handle;
}
```

文件的命名由 3 个部分组成：服务启动时间+启动以来上传的文件数加 1+扩展名，例如：20191224_124808_8.mp4。为了实现这个要求，需要记录服务启动时间和上传文件次数。最简单的方法考虑是做成全局变量，但是在 Nginx 中没有找到实现方法。本来想可以把数据写到本地文件中，但是这样应该会有并发读取的问题，所以决定用 Redis 来保存数据。

## 访问 Redis

Redis 中存放两个数据：1、启动时间；2、计数器。每次上传一个文件就通过启动时间和计数器组合出一个文件名。获取启动时间用`get`命令，获取计数器用`incr`命令。利用 redis2-nginx-module 模块可以把 nginx 变成一个 redis 客户端，我们在`nginx.conf`中添加如下配置：

```
location = /redis/counter {
  redis2_query get $redis_key_upload_start_time;
  redis2_query incr $redis_key_upload_counter;
  redis2_pass redis:6379;
}
```

Redis 除了存储共享信息外，我们还用它进行事件通知，每次完成一个文件的处理后，利用 Redis 的发布订阅机制发送一条上传文件的信息，这样如果其他的系统需要进行扩展可以接收这个事件。在`nginx.conf`中添加如下配置：

```
location = /redis/publish {
  set_unescape_uri $message $arg_message;
  redis2_query publish $redis_channel_upload $message;
  redis2_pass redis:6379;
}
```

# 容器化

为了便于使用，我们将整个项目做成 docker 容器。容器有 3 个：Nginx 容器，Redis 容器和 Redis-cli 容器，其中 Redis-cli 是为了在 Redis 中设置初始值。

## 设置时区

`alpine`镜像默认的时区是`UTC`，和我们差了 8 个小时。前面提到过需要将服务启动时间作为上传文件名的一部分，因此需要把失去调整为`Asia/Shanghai`。Dockerfile 中添加如下内容：

```
RUN sed -i 's?http://dl-cdn.alpinelinux.org/?https://mirrors.aliyun.com/?' /etc/apk/repositories && \
    apk add -U tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    apk del tzdata
```

## Redis 初始值

我们需要每次服务启动时在 Redis 中记录启动时间，想到最简单的方法 Redis 服务启动后，用`redis-cli`执行如下命令。

```
date +'%Y%m%d_%H%M%S' | xargs redis-cli -h redis set uploadBootAt
```

## 环境变量

在`docker-compose.yml`文件中指定环境变量的值，如果需要可以通过`docker-compose.override.yml`文件覆盖。

```
environment:
  - REDIS_KEY_UPLOAD_BOOT_AT=upload:start_time
  - REDIS_KEY_UPLOAD_COUNTER=upload:counter
  - REDIS_CHANNEL_UPLOAD=upload:event
```

## 其他

```
volumes:
  - ./nginx/nginx.conf:/usr/local/nginx/conf/nginx.conf:ro
  - ./nginx/html:/usr/local/nginx/html
  - ./nginx/njs:/usr/local/nginx/njs
  - ./upload:/usr/local/nginx/files
```

这里分享个经验。本来想让文件上传到容器中的`tmp`目录下，然后再改名到`volumes`指定的目录下。但是，这样需要在两个`device`之间移动文件，是不允许的，所以改成了文件直接上传到指定的目录，就地改名。

---

`nginx.conf`中设置连接 Redis。

```
location = /redis/counter {
  redis2_query get $redis_key_upload_start_time;
  redis2_query incr $redis_key_upload_counter;
  redis2_pass redis:6379;
}
```

这需要两个容器之间进行连接，但事先我们并不知道地址是什么，解决的方法是在`docker-compose.yml`中进行指定。

> Containers for the linked service are reachable at a hostname identical to the alias, or the service name if no alias was specified.

```
nginx:
  ...
  links:
      - redis
```

# JS 代码说明

nginx.conf文件
```
env REDIS_KEY_UPLOAD_START_TIME;
```

```
js_set $redis_key_upload_start_time var_redis_key_upload_start_time;
```

njs/upload.js
```
//
function var_redis_key_upload_start_time(r) {
  return process.env.REDIS_KEY_UPLOAD_START_TIME;
}
```

通过`js_set`指令可以解决在`nginx.conf`文件中无法引用环境变量给变量赋值的问题。

----

```
r.subrequest("/redis/counter", { method: "GET" }, function(res) {
  ......
});
```

用`subrequest`方法可以发起调用，但是不能对命名地址（named location）进行调用。

----

```
var fs = require("fs");
fs.renameSync(oFileData.path, newpath);
```

使用`fs`模块可以进行简单的文件操作。但是不能用require调用自己编写的模块。

# 参考

https://github.com/nginx/njs

http://nginx.org/en/docs/

https://github.com/openresty

一篇讲解Nginx变量的文章，推荐阅读：https://blog.csdn.net/ok449a6x1i6qq0g660fv/article/details/80276506