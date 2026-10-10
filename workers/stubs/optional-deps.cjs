/**
 * Empty stand-in for optional, environment-specific dependencies that the bundled worker must not
 * require at runtime (the server has no node_modules):
 *   @azure/identity  – only used for Azure AD authentication (we authenticate with SQL login)
 *   msnodesqlv8      – Windows-native SQL driver we never select
 *   kerberos         – Windows integrated auth we never select
 *   snappy           – TDS compression we never enable
 * Mapping them to this file keeps the bundle self-contained AND the requires resolvable, which is
 * exactly what esbuild's --alias is for.
 */
module.exports = {};
