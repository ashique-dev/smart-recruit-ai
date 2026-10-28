FROM golang:1.26.1-alpine AS compiler
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0 GOBIN=/out
FROM compiler AS server-build
RUN go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM compiler AS client-build
RUN go install github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z
FROM alpine:3.23.3 AS runtime
RUN apk add --no-cache ca-certificates curl && addgroup -S minio && adduser -S -G minio minio && mkdir /data && chown minio:minio /data
USER minio
FROM runtime AS server
COPY --from=server-build /out/minio /usr/local/bin/minio
ENTRYPOINT ["minio"]
FROM runtime AS client
COPY --from=client-build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
