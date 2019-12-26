FROM alpine:3.10

RUN sed -i 's?http://dl-cdn.alpinelinux.org/?https://mirrors.aliyun.com/?' /etc/apk/repositories && \
  apk add -U tzdata && \
  cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
  apk del tzdata && \
  apk add git wget

RUN apk add build-base

RUN apk add pcre-dev openssl-dev zlib-dev 

RUN cd /root && wget http://nginx.org/download/nginx-1.17.6.tar.gz && tar -zxvf nginx-1.17.6.tar.gz
RUN cd /root && wget https://github.com/simplresty/ngx_devel_kit/archive/v0.3.1.tar.gz && tar -zxvf v0.3.1.tar.gz
RUN cd /root && wget https://github.com/openresty/echo-nginx-module/archive/v0.61.tar.gz && tar -zxvf v0.61.tar.gz
RUN cd /root && wget https://github.com/nginx/njs/archive/0.3.7.tar.gz && tar -zxvf 0.3.7.tar.gz
RUN cd /root && wget https://github.com/openresty/set-misc-nginx-module/archive/v0.32.tar.gz && tar -zxvf v0.32.tar.gz
RUN cd /root && wget https://github.com/fdintino/nginx-upload-module/archive/2.3.0.tar.gz && tar -zxvf 2.3.0.tar.gz
RUN cd /root && wget https://github.com/openresty/redis2-nginx-module/archive/v0.15.tar.gz && tar -zxvf v0.15.tar.gz

RUN cd /root/nginx-1.17.6 && \
  ./configure --prefix=/usr/local/nginx --add-module=/root/njs-0.3.7/nginx --add-module=/root/nginx-upload-module-2.3.0 --add-module=/root/ngx_devel_kit-0.3.1 --add-module=/root/echo-nginx-module-0.61 --add-module=/root/set-misc-nginx-module-0.32 --add-module=/root/redis2-nginx-module-0.15 && \
  make && make install

ENV PATH=$PATH 

RUN ln -s /usr/local/nginx/sbin/nginx /usr/sbin/nginx && \
  ln -sf /dev/stdout /usr/local/nginx/logs/access.log && \
  ln -sf /dev/stderr /usr/local/nginx/logs/error.log

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
