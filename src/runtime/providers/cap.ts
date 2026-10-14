import { createCapProvider } from './cap-core'

/** Any self-hosted Cap instance, with the module's own box and no brand line. */
export default createCapProvider('cap', { brand: false, region: 'self-hosted' })
