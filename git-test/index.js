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
    containerApi,
} = require("@scandipwa/magento-scripts/lib/tasks/docker/containers");
const dockerNetwork = require("@scandipwa/magento-scripts/lib/tasks/docker/network");
const KnownError = require("@scandipwa/magento-scripts/lib/errors/known-error");
const { spawn } = require("child_process");

let globalCtx = null;

const initializeContext = async () => {
    if (globalCtx) return globalCtx;

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
            renderer: "silent",
        }
    );

    // Completely suppress console output during initialization
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    process.stdout.write = () => true;
    process.stderr.write = () => true;

    try {
        globalCtx = await tasks.run();

        // Restore all output methods
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
        console.info = originalInfo;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;

        return globalCtx;
    } catch (e) {
        // Restore all output methods in case of error
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
        console.info = originalInfo;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        logger.error(e.message || e);
        process.exit(1);
    }
};

const executeTest = async (argv) => {
    const ctx = await initializeContext();
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
            if (container.connectCommand) {
                argv.commands = container.connectCommand;
            } else {
                argv.commands.push("bash");
            }
        }

        const containerList = await containerApi.ls({
            formatToJSON: true,
            all: true,
            filter: `name=${container.name}`,
        });

        if (containerList.length > 0) {
            const result = await containerApi.exec(
                {
                    container: container.name,
                    command: argv.commands[0],
                },
                { stdio: "pipe" }
            );

            console.log(result.trim());
            return result;
        }

        console.log(`Starting containers...`);

        try {
            const startProcess = spawn("npm", ["run", "start", "--", "-n"], {
                stdio: "pipe",
                cwd: process.cwd(),
            });

            await new Promise((resolve, reject) => {
                startProcess.on("close", (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(
                            new Error(`Start process exited with code ${code}`)
                        );
                    }
                });

                startProcess.on("error", (error) => {
                    reject(error);
                });
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Reset global context to re-detect container name after restart
            globalCtx = null;
            const newCtx = await initializeContext();
            const newContainers = newCtx.config.docker.getContainers(
                newCtx.ports
            );
            const newContainer = newContainers[argv.containername];

            const result = await containerApi.exec(
                {
                    container: newContainer.name,
                    command: argv.commands[0],
                },
                { stdio: "pipe" }
            );

            console.log(result.trim());
            return result;
        } catch (startError) {
            logger.error(
                `Failed to start containers: ${
                    startError.message || startError
                }`
            );
            process.exit(1);
        }
    }

    logger.error(`No container found "${argv.containername}"`);
    process.exit(1);
};

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const runCommand = (command, args = []) => {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, {
            stdio: [0, 1, 2],
        });

        process.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        process.on("error", (error) => {
            reject(error);
        });
    });
};

(async () => {
    try {
        await runCommand("bash", ["-c", "clear"]);
    } catch (e) {
        // Ignore clear command errors
    }

    await wait(50);
    await runCommand("bash", [
        "-c",
        `echo "User: $(git config user.name), $(git config user.email)"`,
    ]);

    await wait(50);
    await runCommand("bash", [
        "-c",
        `echo "\`tput bold\`Branch is: \`tput setaf 2\`$(git branch --show-current)\`tput sgr0\`, $(date +%Y-%m-%d)\`tput sgr0\`"`,
    ]);

    // Do tests
    await executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "composer install --dry-run 2>&1 | grep -q 'The lock file is not up to date with the latest changes in composer.json. You may be getting outdated dependencies. It is recommended that you run' && echo \`tput setaf 1\`'TEST FAILED: composer.lock is broken: SHA does not match the content' || echo \`tput setaf 2\`'composer.lock is integrable and SHA is correct'"`,
        ],
    });

    await executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "composer install --dry-run 2>&1 | grep -q '\\- Installing ' && echo \`tput setaf 1\`'TEST FAILED: composer.lock does not match files in vendor folder' || echo \`tput setaf 2\`'composer.lock is up to date with vendor folder'"`,
        ],
    });

    await executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "if [ \$(git branch --show-current | tr -d '[:space:]') == 'production' ]; then cat composer.lock | grep -q 'markshust/magento2-module-simpledata' && echo \`tput setaf 1\`'TEST FAILED: composer.lock is having a file from dev branch' || echo \`tput setaf 2\`'composer.lock only has required modules'; fi"`,
        ],
    });

    await executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "if [ \$(git branch --show-current | tr -d '[:space:]') == 'dev' ]; then cat composer.lock | grep -q 'markshust/magento2-module-simpledata' || echo \`tput setaf 1\`'TEST FAILED: composer.lock does not have the previously required module for dev branch' && echo \`tput setaf 2\`'composer.lock has previously required module for dev branch'; fi"`,
        ],
    });

    await executeTest({
        containername: "php",
        commands: [
            `/bin/bash -c "cat composer.lock | grep -q 'markshust/magento2-module-pagebuildersourcecode' && echo \`tput setaf 2\`'composer.lock is having the PageBuilder Source Code module installed' || echo \`tput setaf 1\`'TEST FAILED: composer.lock does not have PageBuilder Source Code module installed'"`,
        ],
    });

    // Show git log at the END so it's clean
    console.log("\n--- Git History ---");
    await runCommand("bash", [
        "-c",
        "git --no-pager log --oneline --graph --decorate",
    ]);
})();
