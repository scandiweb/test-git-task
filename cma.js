/** @type {import('@scandipwa/magento-scripts').CMAConfiguration} */
module.exports = {
    magento: {
        first_name: "Scandiweb",
        last_name: "Developer",
        email: "developer@scandipwa.com",
        user: "admin",
        password: "scandipwa123",
        adminuri: "admin",
        mode: "developer",
        edition: "community",
    },
    configuration: {
        elasticsearch: {
            env: {
                ES_JAVA_OPTS: "-Xms4096m -Xmx4096m",
            },
        },
        php: {
            env: {
                CONFIG__DEFAULT__CATALOG__SEARCH__ENGINE: "opensearch",
                CONFIG__DEFAULT__CATALOG__SEARCH__OPENSEARCH_SERVER_HOSTNAME:
                    "localhost",
                CONFIG__DEFAULT__CATALOG__SEARCH__OPENSEARCH_SERVER_PORT:
                    "9200",
                CONFIG__DEFAULT__CATALOG__SEARCH__OPENSEARCH_INDEX_PREFIX:
                    "magento2",
                CONFIG__DEFAULT__CATALOG__SEARCH__OPENSEARCH_ENABLE_AUTH: "0",
            },
        },
    },
};
