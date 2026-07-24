FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY api/Enkl.Api/Enkl.Api.csproj api/Enkl.Api/
RUN dotnet restore api/Enkl.Api/Enkl.Api.csproj
COPY api/Enkl.Api/. api/Enkl.Api/
# No --no-restore here, unlike the original single-project-at-WORKDIR-root layout - a real gotcha
# hit moving the build context to the repo root: with the project living in a SUBDIRECTORY of the
# context (api/Enkl.Api/, not /src itself), `dotnet publish --no-restore` failed with NETSDK1064
# ("Package ... was not found") even though the restore step immediately above it had just succeeded
# cleanly - publish couldn't locate that restore's assets from the different relative path. Publish
# doing its own (fast, cache-hit) re-restore costs a few extra seconds per build but is reliable.
RUN dotnet publish api/Enkl.Api/Enkl.Api.csproj -c Release -o /app
# USER-GUIDE.md lives at the repo root, outside this project's own directory - the AI Assistant's
# system prompt reads it at startup to ground guide-related answers (AiAssistantService.cs). Build
# context had to move to the repo root (see docker-compose.yml/.aws.yml) specifically to reach it;
# copying it into the publish output here means the runtime stage's existing `COPY --from=build /app .`
# picks it up with no second COPY line needed there.
COPY USER-GUIDE.md /app/USER-GUIDE.md

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# Installed BEFORE the app is copied in, deliberately: curl itself never changes between builds, but
# this layer sat after COPY --from=build previously, so it was invalidated (and re-hit Ubuntu's
# package mirrors over the network) on nearly every single build purely because of layer ordering,
# not because it ever needed to. Docker's own layer cache now persists this step across app-code
# rebuilds — it only reruns if this Dockerfile or the base image itself changes.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app .
EXPOSE 8080
# Security review finding M8: the base image otherwise runs as root with no USER directive at all.
# Kestrel binds to 8080 (non-privileged), so the aspnet image's built-in non-root "app" user works
# with no other changes needed.
USER app
ENTRYPOINT ["dotnet", "Enkl.Api.dll"]
