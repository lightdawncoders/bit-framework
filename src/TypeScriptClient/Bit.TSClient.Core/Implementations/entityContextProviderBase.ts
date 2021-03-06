﻿module Bit.Implementations {

    export class EntityContextProviderBase implements Contracts.IEntityContextProvider {

        public constructor(public guidUtils: DefaultGuidUtils, public metadataProvider: Contracts.IMetadataProvider) {

        }

        private oDataJSInitPromise: Promise<void> = null;

        public async oDataJSInit(): Promise<void> {

            if (this.oDataJSInitPromise == null) {

                const originalJsonHandlerWrite = odatajs.oData.json.jsonHandler.write;

                odatajs.oData.json.jsonHandler.write = function (request, context) {

                    if (request.headers["Content-Type"] == null)
                        request.headers["Content-Type"] = "application/json";

                    request.headers["Content-Type"] += ";IEEE754Compatible=true";

                    return originalJsonHandlerWrite.apply(this, arguments);

                };

                $data["defaults"].oDataWebApi = true;

                $data["defaults"].parameterResolutionCompatibility = false;

                $data["defaults"].withReferenceMethods = true;

                $data["defaults"].enableDeepSave = true;

                $data["defaults"].openTypeDefaultPropertyName = "Properties";

                const originalArrayRequired = $data["Validation"].EntityValidation.prototype.supportedValidations["$data.Array"].required;

                $data["Validation"].EntityValidation.prototype.supportedValidations["$data.Array"].required = function required(value, definedValue) {
                    return originalArrayRequired.apply(this, arguments) && value.length != 0;
                }

                for (let typeName of ["Boolean", "DateTimeOffset", "Decimal", "Float", "Guid", "Int16", "Int32", "Int64", "String"]) {

                    const originalRequired = $data["Validation"].EntityValidation.prototype.supportedValidations[`$data.${typeName}`].required;

                    $data["Validation"].EntityValidation.prototype.supportedValidations[`$data.${typeName}`].required = function required(value, definedValue) {
                        return originalRequired.apply(this, arguments) && value != "";
                    }

                }

                this.oDataJSInitPromise = new Promise<void>(async (resolve, reject) => {

                    try {

                        const metadata = await this.metadataProvider.getMetadata();

                        metadata.Dtos
                            .forEach(dto => {

                                const parts = dto.DtoType.split(".");
                                let jayDataDtoType: any = window;

                                for (let part of parts) {
                                    jayDataDtoType = jayDataDtoType[part];
                                    if (jayDataDtoType == null)
                                        return;
                                }

                                const memberDefenitions = jayDataDtoType != null ? jayDataDtoType.memberDefinitions : null;

                                if (memberDefenitions != null) {

                                    metadata.Dtos
                                        .forEach(dto => {

                                            for (let memberName in memberDefenitions) {
                                                if (memberName.startsWith("$") && memberDefenitions.hasOwnProperty(memberName)) {
                                                    const memberDefenition = memberDefenitions[memberName];
                                                    const mem = dto.MembersMetadata.find(m => `$${m.DtoMemberName}` == memberName);
                                                    if (mem != null) {
                                                        memberDefenition.required = mem.IsRequired == true;
                                                        if (mem.Pattern != null) {
                                                            memberDefenition.regex = mem.Pattern;
                                                        }
                                                    }
                                                }
                                            }

                                        });

                                }

                            });

                        const originalPrepareRequest = odatajs.oData.utils.prepareRequest;

                        const clientAppProfile = ClientAppProfileManager.getCurrent().getClientAppProfile();

                        const guidUtils = this.guidUtils;

                        odatajs.oData.utils.prepareRequest = function (request, handler, context) {
                            request.headers = request.headers || {};
                            if (clientAppProfile.currentTimeZone != null && clientAppProfile.currentTimeZone != "")
                                request.headers["Current-Time-Zone"] = clientAppProfile.currentTimeZone;
                            if (clientAppProfile.desiredTimeZone != null && clientAppProfile.desiredTimeZone != "")
                                request.headers["Desired-Time-Zone"] = clientAppProfile.desiredTimeZone;
                            if (clientAppProfile.version != null && clientAppProfile.version != "")
                                request.headers["Client-App-Version"] = clientAppProfile.version;
                            if (clientAppProfile.clientType != null && clientAppProfile.clientType != "")
                                request.headers["Client-Type"] = clientAppProfile.clientType;
                            if (clientAppProfile.culture != null && clientAppProfile.culture != "")
                                request.headers["Client-Culture"] = clientAppProfile.culture;
                            if (clientAppProfile.screenSize != null && clientAppProfile.screenSize != "")
                                request.headers["Client-Screen-Size"] = clientAppProfile.screenSize;
                            if (location.pathname != null && location.pathname != "")
                                request.headers["Client-Route"] = location.pathname;
                            if (clientAppProfile.theme != null && clientAppProfile.theme != "")
                                request.headers["Client-Theme"] = clientAppProfile.theme;
                            if (clientAppProfile.isDebugMode != null)
                                request.headers["Client-Debug-Mode"] = clientAppProfile.isDebugMode;
                            request.headers["Client-Date-Time"] = new Date().toISOString();
                            if (navigator.language != null && navigator.language != "")
                                request.headers["System-Language"] = navigator.language;
                            if (navigator["systemLanguage"] != null && navigator["systemLanguage"] != "")
                                request.headers["Client-Sys-Language"] = navigator["systemLanguage"];
                            if (navigator.platform != null && navigator.platform != "")
                                request.headers["Client-Platform"] = navigator.platform;
                            const results = originalPrepareRequest.apply(this, arguments);
                            if (request.headers["Content-Type"] == null)
                                request.headers["Content-Type"] = "application/json";
                            if (!request.headers["Content-Type"].includes(";IEEE754Compatible=true"))
                                request.headers["Content-Type"] += ";IEEE754Compatible=true";
                            if (request.headers["X-CorrelationId"] == null)
                                request.headers["X-CorrelationId"] = guidUtils.newGuid();
                            if (request.headers["Bit-Client-Type"] == null)
                                request.headers["Bit-Client-Type"] = "TS-Client";
                            return results;
                        };

                        const originalRead = odatajs.oData.json.jsonHandler.read;

                        odatajs.oData.json.jsonHandler.read = function (response, context) {

                            if (response.body != null && typeof response.body === "string") {
                                response.body = (response.body as string).replace(/:\s*(\d{14,}.\d{2,})\s*([,\}])/g, ':"$1"$2');
                                // this will change "{ number : 214748364711111.2 }" to "{ number : '214748364711111.2' }"
                            }

                            return originalRead.apply(this, arguments);

                        }

                        resolve();
                    }
                    catch (e) {
                        reject(e);
                        throw e;
                    }
                });
            }

            return this.oDataJSInitPromise;
        }

        public static defaultOfflineDbProvider: "indexedDb" | "webSql" | "local" = "local";

        private isOfflineDbProvider(providerName: string): boolean {
            return providerName == "indexedDb" || providerName == "webSql" || providerName == "local";
        }

        @Log()
        public async getContext<TContext extends $data.EntityContext>(contextName: string, config?: { isOffline?: boolean, jayDataConfig?: any }): Promise<TContext> {

            if (config == null)
                config = {};

            if (config.isOffline == null)
                config.isOffline = false;

            if (contextName == null)
                throw new Error("contextName argument may not be null");

            await this.oDataJSInit();

            let cfg = null;

            const baseVal = document.getElementsByTagName("base")[0];

            const oDataServiceHost = `${baseVal != null ? baseVal.getAttribute("href") : "/"}odata/${contextName}`;

            if (config.isOffline == false) {
                cfg = {
                    name: "oData",
                    oDataServiceHost: oDataServiceHost,
                    withCredentials: false,
                    maxDataServiceVersion: "4.0"
                };
            }
            else {
                cfg = {
                    provider: EntityContextProviderBase.defaultOfflineDbProvider, databaseName: contextName + "V" + ClientAppProfileManager.getCurrent().getClientAppProfile().version
                }
            }

            cfg = Object.assign(cfg, config.jayDataConfig || {});

            const ContextType = window[`${contextName}Context`];

            if (ContextType == null)
                throw new Error(`No entity context could be found named ${contextName}`);

            if (ContextType["eventsListenersAreAdded"] != true && config.isOffline == true) {

                for (let memberDefenitionKey in ContextType.memberDefinitions) {

                    if (!ContextType.memberDefinitions.hasOwnProperty(memberDefenitionKey)) {
                        continue;
                    }

                    const memberDefenition = ContextType.memberDefinitions[memberDefenitionKey];

                    if (memberDefenition == null || memberDefenition.kind != "property" || memberDefenition.elementType == null)
                        continue;

                    memberDefenition.elementType["addEventListener"]("beforeCreate", (sender: any, e: Model.Contracts.ISyncableDto) => {
                        const context = e["context"];
                        const storeToken = e["storeToken"];
                        if (context != null && context.ignoreEntityEvents != true && (this.isOfflineDbProvider(context.storageProvider.name) || (storeToken != null && this.isOfflineDbProvider(storeToken.args.provider)))) {
                            const eType = e.getType();
                            const members = eType.memberDefinitions as any;
                            for (let keyMember of members.getKeyProperties()) {
                                if (keyMember.originalType == "Edm.Guid" && e[keyMember.name] == null) {
                                    e[keyMember.name] = this.guidUtils.newGuid();
                                }
                            }
                            if (members["$IsArchived"] != null && e.IsArchived == null)
                                e.IsArchived = false;
                            if (members["$Version"] != null) {
                                if (e.Version == null) {
                                    e.Version = "0000000000000000000";
                                }
                                if (e.Version != "0000000000000000000")
                                    throw new Error("An entity has been created with version other than null or zero.");
                            }
                            if (members["$IsSynced"] != null)
                                e.IsSynced = false;
                        }
                    });

                    memberDefenition.elementType["addEventListener"]("beforeUpdate", (sender: any, e: Model.Contracts.ISyncableDto) => {
                        const context = e["context"];
                        const storeToken = e["storeToken"];
                        if (context != null && context.ignoreEntityEvents != true && (this.isOfflineDbProvider(context.storageProvider.name) || (storeToken != null && this.isOfflineDbProvider(storeToken.args.provider)))) {
                            const eType = e.getType();
                            const members = eType.memberDefinitions;
                            if (members["$IsSynced"] != null)
                                e.IsSynced = false;
                        }
                    });

                    memberDefenition.elementType["addEventListener"]("beforeDelete", (sender: any, e: Model.Contracts.ISyncableDto) => {
                        const context = e["context"];
                        const storeToken = e["storeToken"];
                        if (context != null && context.ignoreEntityEvents != true && (this.isOfflineDbProvider(context.storageProvider.name) || (storeToken != null && this.isOfflineDbProvider(storeToken.args.provider)))) {
                            if (e.Version != null && e.Version != "0000000000000000000") {
                                const eType = e.getType();
                                const members = eType.memberDefinitions;
                                if (members["$IsSynced"] != null)
                                    e.IsSynced = false;
                                if (members["$IsArchived"] != null) {
                                    e.IsArchived = true;
                                    e.entityState = $data.EntityState.Modified;
                                }
                            }
                        }
                    });

                }

                ContextType["eventsListenersAreAdded"] = true;
            }

            const context: TContext = new ContextType(cfg);
            context.trackChanges = true;
            await context.onReady();

            return context;

        }
    }
}
