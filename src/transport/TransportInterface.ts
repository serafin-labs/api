import { PipelineAbstract } from "@serafin/pipeline"
import { Api } from "../Api"

/**
 * Transport represent a way to expose pipelines to an external interface.
 * It can be REST HTTP services, web sockets, graphql queries, etc.
 */
export interface TransportInterface {
    /**
     * Init this transport
     */
    init(api: Api): void

    /**
     * The 'use' method is called by the Api class to pass the pipeline to register
     */
    use(pipeline: PipelineAbstract<any>, name: string, pluralName: string): void
}
