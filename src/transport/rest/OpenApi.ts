import { ParameterObject } from "@serafin/open-api"
import { PipelineAbstract } from "@serafin/pipeline"
import * as _ from "lodash"
import { Api } from "../../Api"
import { flattenSchemas, jsonSchemaToOpenApiSchema, removeDuplicatedParameters, schemaToOpenApiParameter } from "../../util/openApiUtils"

function mapSchemaBuilderName(schemaBuilderName: string, modelName: string) {
    if (schemaBuilderName === "modelSchemaBuilder") {
        return modelName
    } else {
        return modelName + _.upperFirst(schemaBuilderName.replace("SchemaBuilder", ""))
    }
}
export class OpenApi {
    private resourcesPathWithId
    private upperName: string
    private upperPluralName: string

    constructor(
        private api: Api,
        private pipeline: PipelineAbstract<any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any>,
        private resourcesPath,
        private name: string,
        private pluralName: string,
    ) {
        // import pipeline schemas to openApi definitions
        this.upperName = _.upperFirst(name)
        this.upperPluralName = _.upperFirst(pluralName)

        for (let schemaBuilderName in pipeline.schemaBuilders) {
            if (pipeline.schemaBuilders[schemaBuilderName] && !/Options$|Query$/.test(schemaBuilderName)) {
                let schemaName = mapSchemaBuilderName(schemaBuilderName, this.upperName)
                let schema = jsonSchemaToOpenApiSchema(_.cloneDeep(pipeline.schemaBuilders[schemaBuilderName].schema))
                schema.title = schemaName
                this.api.openApi.components.schemas[schemaName] = schema
            }
        }
        flattenSchemas(this.api.openApi.components.schemas)

        // prepare open API metadata for each endpoint
        this.resourcesPathWithId = `${resourcesPath}/{id}`
        this.api.openApi.paths[this.resourcesPath] = this.api.openApi.paths[this.resourcesPath] || {}
        this.api.openApi.paths[this.resourcesPathWithId] = this.api.openApi.paths[this.resourcesPathWithId] || {}
    }

    addReadDoc() {
        let readQueryParameters = schemaToOpenApiParameter(this.pipeline.schemaBuilders.readQuery.schema as any, this.api.openApi)
        let readOptionsParameters = this.api.filterInternalParameters(
            schemaToOpenApiParameter(this.pipeline.schemaBuilders.readOptions.schema as any, this.api.openApi),
        )

        // general get
        this.api.openApi.paths[this.resourcesPath]["get"] = {
            description: `Find ${this.upperPluralName}`,
            operationId: `find${this.upperPluralName}`,
            parameters: removeDuplicatedParameters([...readQueryParameters, ...readOptionsParameters]),
            responses: {
                200: {
                    description: `${this.upperPluralName} corresponding to the query`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}ReadMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }

        // get by id
        this.api.openApi.paths[this.resourcesPathWithId]["get"] = {
            description: `Get one ${this.upperName} by its id`,
            operationId: `get${this.upperName}ById`,
            parameters: [
                {
                    in: "path",
                    name: "id",
                    schema: { type: "string" },
                    required: true,
                },
            ],
            responses: {
                200: {
                    description: `${this.upperPluralName} corresponding to the provided id`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}ReadMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                404: {
                    description: "Not Found",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }
    }

    addCreateDoc() {
        let createOptionsParameters = this.api.filterInternalParameters(
            schemaToOpenApiParameter(this.pipeline.schemaBuilders.createOptions.schema as any, this.api.openApi),
        )

        // post a new resource
        this.api.openApi.paths[this.resourcesPath]["post"] = {
            description: `Create a new ${this.upperName}`,
            operationId: `add${this.upperName}`,
            parameters: removeDuplicatedParameters(createOptionsParameters),
            requestBody: {
                description: `The ${this.upperName} to be created.`,
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "array",
                            items: { $ref: `#/components/schemas/${this.upperName}CreateValues` },
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: `${this.upperName} created`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}CreateMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                409: {
                    description: "Conflict",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }
    }

    addPatchDoc(withId: boolean) {
        let patchQueryParameters = schemaToOpenApiParameter(this.pipeline.schemaBuilders.patchQuery.schema as any, this.api.openApi)
        let patchOptionsParameters = this.api.filterInternalParameters(
            schemaToOpenApiParameter(this.pipeline.schemaBuilders.patchOptions.schema as any, this.api.openApi),
        )

        // patch by id
        this.api.openApi.paths[withId ? this.resourcesPathWithId : this.resourcesPath]["patch"] = {
            description: withId ? `Patch a ${this.upperName} using its id` : `Patch many ${this.upperPluralName}`,
            operationId: `patch${withId ? this.upperName : this.upperPluralName}`,
            parameters: removeDuplicatedParameters([
                ...(withId
                    ? [
                          {
                              in: "path",
                              name: "id",
                              schema: { type: "string" },
                              required: true,
                          } as ParameterObject,
                      ]
                    : []),
                ...patchQueryParameters,
                ...patchOptionsParameters,
            ]),
            requestBody: {
                description: `The patch of ${this.upperName}.`,
                required: true,
                content: {
                    "application/json": {
                        schema: { $ref: `#/components/schemas/${this.upperName}PatchValues` },
                    },
                },
            },
            responses: {
                200: {
                    description: `Updated ${withId ? this.upperName : this.upperPluralName}`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}PatchMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                ...(withId && {
                    404: {
                        description: "Not Found",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                            },
                        },
                    },
                }),
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }
    }

    addReplaceDoc() {
        let replaceOptionsParameters = this.api.filterInternalParameters(
            schemaToOpenApiParameter(this.pipeline.schemaBuilders.replaceOptions.schema as any, this.api.openApi),
        )

        // put by id
        this.api.openApi.paths[this.resourcesPathWithId]["put"] = {
            description: `Put a ${this.upperName} using its id`,
            operationId: `put${this.upperName}`,
            parameters: removeDuplicatedParameters(replaceOptionsParameters).concat([
                {
                    in: "path",
                    name: "id",
                    schema: { type: "string" },
                    required: true,
                },
            ]),
            requestBody: {
                description: `The ${this.upperName} to be replaced.`,
                required: true,
                content: {
                    "application/json": {
                        schema: { $ref: `#/components/schemas/${this.upperName}ReplaceValues` },
                    },
                },
            },
            responses: {
                200: {
                    description: `Replaced ${this.upperName}`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}ReplaceMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                404: {
                    description: "Not Found",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }
    }

    addDeleteDoc(withId: boolean) {
        let deleteQueryParameters = schemaToOpenApiParameter(this.pipeline.schemaBuilders.deleteQuery.schema as any, this.api.openApi)
        let deleteOptionsParameters = this.api.filterInternalParameters(
            schemaToOpenApiParameter(this.pipeline.schemaBuilders.deleteOptions.schema as any, this.api.openApi),
        )
        // delete by id
        this.api.openApi.paths[withId ? this.resourcesPathWithId : this.resourcesPath]["delete"] = {
            description: withId ? `Delete a ${this.upperName} using its id` : `Delete many ${this.upperPluralName}`,
            operationId: `delete${withId ? this.upperName : this.upperPluralName}`,
            parameters: removeDuplicatedParameters([
                ...(withId
                    ? [
                          {
                              in: "path",
                              name: "id",
                              schema: { type: "string" },
                              required: true,
                          } as ParameterObject,
                      ]
                    : []),
                ...deleteQueryParameters,
                ...deleteOptionsParameters,
            ]),
            responses: {
                200: {
                    description: `Deleted ${withId ? this.upperName : this.upperPluralName}`,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    data: {
                                        type: "array",
                                        items: { $ref: `#/components/schemas/${this.upperName}Model` },
                                    },
                                    meta: { $ref: `#/components/schemas/${this.upperName}DeleteMeta` },
                                },
                            },
                        },
                    },
                },
                400: {
                    description: "Bad request",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
                ...(withId && {
                    404: {
                        description: "Not Found",
                        content: {
                            "application/json": {
                                schema: { $ref: "#/components/schemas/Error" },
                            },
                        },
                    },
                }),
                default: {
                    description: "Unexpected error",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Error" },
                        },
                    },
                },
            },
        }
    }
}
