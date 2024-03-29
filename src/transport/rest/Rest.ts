import {
    ConflictErrorName,
    MovedPermanentlyErrorName,
    NotFoundErrorName,
    NotImplementedErrorName,
    PipelineAbstract,
    UnauthorizedErrorName,
    ValidationErrorName,
} from "@serafin/pipeline"
import { JSONSchema, SchemaBuilder } from "@serafin/schema-builder"
import * as express from "express"
import * as _ from "lodash"
import { VError } from "verror"
import { Api } from "../../Api"
import { TransportInterface } from "../TransportInterface"
import { OpenApi } from "./OpenApi"
import { restMiddlewareJson, restRootMiddlewareJson } from "./RestMiddlewareJson"

export interface Error {
    name: string
    message: string
    info?: any
    cause?: any
    jse_cause: { name: string }
}

export interface RestOptions {
    /**
     * If provided, the Api will use this function to gather internal options for this request.
     * It can be used for example to pass _user or _role to the underlying pipeline.
     */
    internalOptions?: (req: express.Request) => Object
    /*
     * Allows you to execute custom code on error, primarily useful if you want to add extra logging
     */
    onError?: (error: Error) => void
}

export class RestTransport implements TransportInterface {
    public api: Api
    constructor(protected options: RestOptions = {}) {}

    init(api: Api) {
        this.api = api
        this.api.application.use(this.api.basePath, restRootMiddlewareJson(this.api))
    }

    /**
     * Use the given pipeline.
     *
     * @param pipeline
     * @param name
     * @param pluralName
     */
    use(
        pipeline: PipelineAbstract<any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any>,
        name: string,
        pluralName: string,
    ) {
        // setup the router
        let endpointPath = `${this.api.basePath}/${pluralName}`
        let resourcesPath = `/${pluralName}`

        let openApi = new OpenApi(this.api, pipeline, resourcesPath, name, pluralName)

        let availableMethods = RestTransport.availableMethods(pipeline)

        if (availableMethods.canRead) {
            this.testOptionsAndQueryConflict(pipeline.schemaBuilders.readQuery.schema, pipeline.schemaBuilders.readOptions.schema)
        }
        if (availableMethods.canPatch) {
            this.testOptionsAndQueryConflict(pipeline.schemaBuilders.patchQuery.schema, pipeline.schemaBuilders.patchOptions.schema)
        }
        if (availableMethods.canDelete) {
            this.testOptionsAndQueryConflict(pipeline.schemaBuilders.deleteQuery.schema, pipeline.schemaBuilders.deleteOptions.schema)
        }

        // attach the routers to the express app
        this.api.application.use(endpointPath, restMiddlewareJson(this, pipeline, openApi, endpointPath, resourcesPath, name))
    }

    // error handling closure for this endpoint
    public handleError(error, res: express.Response, next: (err?: any) => void) {
        if (this.options.onError) {
            this.options.onError(error)
        }
        // handle known errors
        if (
            ![
                [ValidationErrorName, 400],
                [NotFoundErrorName, 404],
                [ConflictErrorName, 409],
                [NotImplementedErrorName, 405],
                [UnauthorizedErrorName, 401],
                [MovedPermanentlyErrorName, 301],
            ].some((p: [string, number]) => {
                let [errorName, code] = p
                const causeByName = VError.findCauseByName(error, errorName)
                if (causeByName) {
                    if (code === 301) {
                        const location = VError.info(causeByName).location
                        if (location) {
                            res.header("Location", location)
                        }
                    }
                    res.status(code).json({
                        code: code,
                        message: error.message,
                    })
                    return true
                }
                return false
            })
        ) {
            // or pass the error down the chain
            console.error(VError.fullStack(error))
            next(error)
        }
    }

    public handleOptionsAndQuery(
        req: express.Request,
        res: express.Response,
        next: () => any,
        optionsSchemaBuilder: SchemaBuilder<any>,
        querySchemaBuilder: SchemaBuilder<any> = null,
        id?: string | string[],
    ): { options: object; query: object } {
        try {
            let pipelineOptions = this.api.filterInternalOptions(_.cloneDeep(req.query))
            if (this.options.internalOptions) {
                _.merge(pipelineOptions, this.options.internalOptions(req))
            }
            optionsSchemaBuilder.validate(pipelineOptions)

            let pipelineQuery = {}
            if (querySchemaBuilder !== null) {
                pipelineQuery = id ? { ..._.cloneDeep(req.query), id } : _.cloneDeep(req.query)
                querySchemaBuilder.validate(pipelineQuery)
            }
            return { options: pipelineOptions, query: pipelineQuery }
        } catch (e) {
            this.handleError(Api.apiError(e, req), res, next)
        }
        return null
    }

    private testOptionsAndQueryConflict(optionsSchema: JSONSchema, querySchema: JSONSchema): void {
        if (optionsSchema && querySchema) {
            let intersection = _.intersection(Object.keys(optionsSchema.properties || {}), Object.keys(querySchema.properties || {}))
            if (intersection.length > 0) {
                throw new VError("SerafinRestParamsNameConflict", `Name conflict between options and query (${intersection.toString()})`, {
                    conflict: intersection,
                    optionsSchema: optionsSchema,
                    querySchema: querySchema,
                })
            }
        }
    }

    public static availableMethods(pipeline: PipelineAbstract<any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any, any>) {
        return {
            canRead: !!pipeline.schemaBuilders.readQuery,
            canCreate: !!pipeline.schemaBuilders.createValues,
            canReplace: !!pipeline.schemaBuilders.replaceValues,
            canPatch: !!pipeline.schemaBuilders.patchValues,
            canDelete: !!pipeline.schemaBuilders.deleteQuery,
        }
    }
}
