# Two stages: the JDK and Maven are needed to build, not to run. Shipping only
# the JRE and the jar takes the image from roughly 450MB to 200MB, and leaves a
# compiler out of the running container.
FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /build

# Dependencies are copied and resolved before the source. Docker caches layers,
# so editing a Java file re-runs only the compile step — while a change to
# pom.xml correctly invalidates the download too.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

COPY src ./src

# Tests are skipped here deliberately. They run against a real PostgreSQL via
# Testcontainers, which needs a Docker daemon — and there is none inside a
# Docker build. The test suite runs in CI, where there is.
RUN ./mvnw clean package -DskipTests -B


FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# A non-root user, because a container that only serves HTTP has no reason to
# run as root: it turns a remote code execution into a contained one.
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=build --chown=app:app /build/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
