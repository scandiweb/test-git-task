// #!/usr/bin/env node
const { Listr } = require("listr2");
const logger = require("@scandipwa/scandipwa-dev-utils/logger");
const {
    checkRequirements,
} = require("@scandipwa/magento-scripts/lib/tasks/requirements");
const getMagentoVersionConfig = require("@scandipwa/magento-scripts/lib/config/get-magento-version-config");
const checkConfigurationFile = require("@scandipwa/magento-scripts/lib/config/check-configuration-file");
const getProjectConfiguration = require("@scandipwa/magento-scripts/lib/config/get-project-configuration");
const {
    getCachedPorts,
} = require("@scandipwa/magento-scripts/lib/config/get-port-config");
const {
    executeInContainer,
    runInContainer,
} = require("@scandipwa/magento-scripts/lib/util/execute-in-container");
const {
    containerApi,
} = require("@scandipwa/magento-scripts/lib/tasks/docker/containers");
const dockerNetwork = require("@scandipwa/magento-scripts/lib/tasks/docker/network");
const KnownError = require("@scandipwa/magento-scripts/lib/errors/known-error");
const { spawn } = require("child_process");

/**
 *
 * @param {{ containername: string, commands: string[] }} argv
 * @returns
 */
const executeTest = async (argv) => {
    const tasks = new Listr(
        [
            checkRequirements(),
            getMagentoVersionConfig(),
            checkConfigurationFile(),
            getProjectConfiguration(),
            getCachedPorts(),
            dockerNetwork.tasks.createNetwork(),
        ],
        {
            concurrent: false,
            exitOnError: true,
            ctx: { throwMagentoVersionMissing: true },
            rendererOptions: { collapse: false, clearOutput: true },
        }
    );

    let ctx;
    try {
        ctx = await tasks.run();
    } catch (e) {
        logger.error(e.message || e);
        process.exit(1);
    }
    const containers = ctx.config.docker.getContainers(ctx.ports);
    const services = Object.keys(containers);

    if (
        services.includes(argv.containername) ||
        services.some((service) => service.includes(argv.containername))
    ) {
        const containerResult = containers[argv.containername]
            ? containers[argv.containername]
            : Object.entries(containers).find(([key]) =>
                  key.includes(argv.containername)
              );

        if (!containerResult) {
            logger.error(`No container found "${argv.containername}"`);
            process.exit(1);
        }

        const container =
            containerResult && Array.isArray(containerResult)
                ? containerResult[1]
                : containerResult;

        if (argv.commands.length === 0) {
            // if we have default connect command then use it
            if (container.connectCommand) {
                argv.commands = container.connectCommand;
            } else {
                // otherwise fall back to bash (if it exists inside container)
                argv.commands.push("bash");
            }
        }

        const containerList = await containerApi.ls({
            formatToJSON: true,
            all: true,
            filter: `name=${container.name}`,
        });

        if (containerList.length > 0) {
            const result = await runInContainer(
                {
                    ...container,
                    name: `${container.name}_exec-${Date.now()}`,
                },
                argv.commands
            );

            return result;
        }

        throw new KnownError(`Container ${container.name} is not running!`);
    }

    logger.error(`No container found "${argv.containername}"`);
    process.exit(1);
};

(async () => {
    spawn("git", ["config", "user.name"], {
        stdio: [0, 1, 2],
    });

    spawn("bash", ["-c", "git --no-pager log --oneline"], {
        stdio: [0, 1, 2],
    });

    executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "composer install --dry-run 2>&1 | grep -q 'The lock file is not up to date with the latest changes in composer.json. You may be getting outdated dependencies. It is recommended that you run' && echo \`tput setaf 1\`'composer.lock is broken: SHA does not match the content' || echo \`tput setaf 2\`'composer.lock is integrable and SHA is correct'"`,
        ],
    });

    executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "composer install --dry-run 2>&1 | grep -q '\\- Installing ' && echo \`tput setaf 1\`'composer.lock does not match files in vendor folder' || echo \`tput setaf 2\`'composer.lock is up to date with vendor folder'"`,
        ],
    });

    executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "cat composer.lock | grep -q 'markshust/magento2-module-simpledata' && echo \`tput setaf 1\`'composer.lock is having a file from dev branch!' || echo \`tput setaf 2\`'composer.lock only has required modules'"`,
        ],
    });

    executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "cat composer.lock | grep -q 'markshust/magento2-module-disabletwofactorauth' && echo \`tput setaf 2\`'composer.lock is having the 2FA module installed' || echo \`tput setaf 1\`'composer.lock does not have 2FA module installed'"`,
        ],
    });
})();
