import { PipelineAbstract } from "@serafin/pipeline"
import * as express from "express"
import ExpressGraphQL from "express-graphql"
import * as graphql from "graphql"
import * as _ from "lodash"
import { Api } from "../../Api"
import { TransportInterface } from "../TransportInterface"
import { jsonSchemaToGraphQL } from "./jsonSchemaToGraphQL"

export interface GraphQLOptions {
    /**
     * If provided, the Api will use this function to gather internal options for graphql queries.
     * It can be used for example to pass _user or _role to the underlying pipeline.
     */
    internalOptions?: (req: express.Request) => Object

    /**
     * If true, graphiql is automatically activated on '[apiPath]/graphql' when accessing with a browser.
     * @default false
     */
    graphiql?: boolean

    /**
     * If true, the schema of graphql queries is automatically exposed on '[apiPath]/graphqlSchema'.
     * @default false
     */
    schema?: boolean
}

/**
 * A Transport to expose pipelines as graphql queries.
 * It creates automatically a 'graphql' endpoint where you can send your requests.
 * /!\ The graphql transport supports only a subpart of pipelines capabilities currently. Only read is available and there are restrictions on the json schema features you can use.
 */
export class GraphQLTransport implements TransportInterface {
    private api: Api | undefined
    private graphQlModelTypes: {
        pipeline: PipelineAbstract
        schema: graphql.GraphQLObjectType
    }[] = []
    private graphQlSchemaQueries: any = {}
    private _graphQlSchema: graphql.GraphQLSchema | undefined
    private get graphQlSchema() {
        if (!this._graphQlSchema) {
            this._graphQlSchema = new graphql.GraphQLSchema({
                query: new graphql.GraphQLObjectType({
                    name: "Query",
                    fields: this.graphQlSchemaQueries,
                }),
            })
        }
        return this._graphQlSchema
    }
    protected graphQlRoot: any = {}
    constructor(protected options: GraphQLOptions = {}) {}

    /**
     * Attach this transport to the Api
     *
     * @param api
     */
    init(api: Api) {
        this.api = api
        let graphqlPath = `${this.api.basePath}/graphql`
        this.api.application.use(
            graphqlPath,
            ExpressGraphQL(() => {
                return {
                    schema: this.graphQlSchema,
                    rootValue: this.graphQlRoot,
                    graphiql: this.options.hasOwnProperty("graphiql") ? this.options.graphiql : false,
                }
            }),
        )
        if (this.options.schema === true) {
            let graphqlSchemaPath = `${this.api.basePath}/graphqlSchema`
            this.api.application.get(graphqlSchemaPath, (req, res) => {
                res.send(graphql.printSchema(this.graphQlSchema)).status(200).end()
            })
        }
    }

    /**
     * Use the given pipeline.
     *
     * @param pipeline
     * @param name
     * @param pluralName
     */
    use(pipeline: PipelineAbstract<any>, name: string, pluralName: string) {
        const api = this.api
        if (!api) {
            throw new Error("Misconfigured API")
        }
        let relations: any = pipeline.relations

        // prepare Ajv filters

        // let's add the root resolver for this pipeline
        this.graphQlRoot[pluralName] = async (params: any, request: express.Request) => {
            let options = api.filterInternalOptions(_.cloneDeep(params.options || {}))
            if (this.options.internalOptions) {
                _.merge(options, this.options.internalOptions(request))
            }
            let query = _.cloneDeep(params.query || {})
            try {
                pipeline.schemaBuilders.context.validate(options)
                pipeline.schemaBuilders.readQuery.validate(query)
            } catch (e) {
                throw Api.apiError(e, request)
            }

            return await pipeline.read(query, options)
        }

        // let's create the graphql query schema from the pipeline metadata
        // name of the schema
        let schemaName = _.upperFirst(name)

        // transform json schema to graphql objects
        let graphQLSchemas = jsonSchemaToGraphQL(pipeline.modelSchemaBuilder.schema, schemaName, () => true)
        jsonSchemaToGraphQL(pipeline.schemaBuilders.context.schema, `${schemaName}Context`, api.isNotAnInternalOption, graphQLSchemas)
        jsonSchemaToGraphQL(pipeline.schemaBuilders.readQuery.schema, `${schemaName}ReadQuery`, () => true, graphQLSchemas)
        jsonSchemaToGraphQL(pipeline.schemaBuilders.readMeta.schema, `${schemaName}ReadMeta`, () => true, graphQLSchemas)

        // get the schema of the model
        let modelSchema = graphQLSchemas[schemaName]
        // and keep a reference to it for other pipelines that may reference it
        this.graphQlModelTypes.push({
            pipeline: pipeline,
            schema: modelSchema.schema,
        })

        // add relations of this model as sub fields of the graphql schema
        if (relations) {
            for (let relationName in relations) {
                let relation = relations[relationName]
                let relationSchemaName = `${schemaName}${_.upperFirst(relationName)}`
                let existingFieldsFunction = modelSchema.fields
                modelSchema.fields = ((relation, existingFieldsFunction) => () => {
                    // get the existing fields of the unerlying function
                    let existingFields = existingFieldsFunction()
                    // resolve the pipeline reference
                    let pipeline: PipelineAbstract = relation.pipeline()
                    // find the model graphql type of this relation
                    let relationType = _.find(this.graphQlModelTypes, (m) => m.pipeline === pipeline)
                    if (!relationType) {
                        // if the relation type does not exist, this means the pipeline was never added to the api
                        // we have to convert it on the fly
                        let relationModelName = `${schemaName}${_.upperFirst(relation.name)}`
                        let relationGraphQLSchemas = jsonSchemaToGraphQL(pipeline.modelSchemaBuilder.schema, relationModelName, () => true)
                        relationType = {
                            schema: relationGraphQLSchemas[relationModelName].schema,
                            pipeline: pipeline,
                        }
                    }

                    // add the field for this relation
                    if (relation.type === "one") {
                        existingFields[relation.name] = {
                            type: relationType.schema,
                            resolve: async (entity: any) => {
                                if (entity[relation.name]) {
                                    return entity[relation.name]
                                }
                                let result = await relation.fetch(entity)
                                return result.data[0]
                            },
                        }
                    } else {
                        // obtain query and options schemas for this relation
                        let queryFilter = (param: string) => !(param in relation.query)
                        let optionsFilter = (param: string) => api.isNotAnInternalOption(param) && (!relation.options || !(param in relation.options))
                        let relationGraphQlSchemas = jsonSchemaToGraphQL(pipeline.schemaBuilders.context.schema, `${relationSchemaName}Context`, optionsFilter)
                        jsonSchemaToGraphQL(pipeline.schemaBuilders.readQuery.schema, `${relationSchemaName}ReadQuery`, queryFilter, relationGraphQlSchemas)
                        let args = {} as any
                        if (relationGraphQlSchemas[`${relationSchemaName}ReadQuery`]) {
                            args.query = {
                                type: relationGraphQlSchemas[`${relationSchemaName}ReadQuery`].schema,
                            }
                        }
                        if (relationGraphQlSchemas[`${relationSchemaName}Context`]) {
                            args.options = {
                                type: relationGraphQlSchemas[`${relationSchemaName}Context`].schema,
                            }
                        }
                        existingFields[relation.name] = {
                            type: new graphql.GraphQLList(relationType.schema),
                            args: args,
                            resolve: async (entity: any, params: any, request: any) => {
                                if (entity[relation.name]) {
                                    return entity[relation.name]
                                }
                                let options = api.filterInternalOptions(_.cloneDeep(params.options || {}))
                                if (this.options.internalOptions) {
                                    _.merge(options, this.options.internalOptions(request))
                                }
                                let query = _.cloneDeep(params.query || {})
                                let result = await relation.fetch(entity, query, options)
                                return result.data
                            },
                        }
                    }
                    return existingFields
                })(relation, existingFieldsFunction)
            }
        }

        // define the result schema
        let readDataSchema = graphQLSchemas[`${schemaName}ReadMeta`]
        let resultSchemaConfig = {
            name: `${schemaName}ReadResult`,
            fields: {
                data: { type: new graphql.GraphQLList(modelSchema.schema) },
            } as any,
        }
        if (readDataSchema) {
            resultSchemaConfig.fields.meta = { type: readDataSchema.schema }
        }
        let resultSchema = new graphql.GraphQLObjectType(resultSchemaConfig)

        // create the main query function for this pipeline
        let args = {} as any
        if (graphQLSchemas[`${schemaName}ReadQuery`]) {
            args.query = { type: graphQLSchemas[`${schemaName}ReadQuery`].schema }
        }
        if (graphQLSchemas[`${schemaName}Context`]) {
            args.options = { type: graphQLSchemas[`${schemaName}Context`].schema }
        }
        this.graphQlSchemaQueries[pluralName] = {
            type: resultSchema,
            args: args,
        }
    }
}
