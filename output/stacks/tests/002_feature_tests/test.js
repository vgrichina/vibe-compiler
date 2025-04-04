const tape = require('tape');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { log, parseArgs, loadStaticPlugins, loadDynamicPlugins, executeDynamicPlugins, main } = require('./bin/vibec.js');

tape('Logging functionality', async (t) => {
  // Save the original logger and create a mock
  const originalLogger = log.logger;
  let logOutput = [];
  
  log.logger = (...args) => {
    logOutput.push(args.join(' '));
  };
  
  try {
    // Test info logging with ANSI colors
    logOutput = [];
    log.info('Info message');
    t.true(logOutput[0].includes('\x1b[36mInfo message\x1b[0m'), 'log.info should output cyan text');
    
    // Test warning logging with ANSI colors
    logOutput = [];
    log.warn('Warning message');
    t.true(logOutput[0].includes('\x1b[33mWarning message\x1b[0m'), 'log.warn should output yellow text');
    
    // Test error logging with ANSI colors
    logOutput = [];
    log.error('Error message');
    t.true(logOutput[0].includes('\x1b[31mError message\x1b[0m'), 'log.error should output red text');
    
    // Test success logging with ANSI colors
    logOutput = [];
    log.success('Success message');
    t.true(logOutput[0].includes('\x1b[32mSuccess message\x1b[0m'), 'log.success should output green text');
    
    // Test debug logging - should not output when VIBEC_DEBUG is not set
    logOutput = [];
    delete process.env.VIBEC_DEBUG;
    log.debug('Debug message without flag');
    t.equal(logOutput.length, 0, 'log.debug should not output when VIBEC_DEBUG is not set');
    
    // Test debug logging - should output when VIBEC_DEBUG=1
    logOutput = [];
    process.env.VIBEC_DEBUG = '1';
    log.debug('Debug message with flag');
    t.true(logOutput[0].includes('\x1b[35mDebug message with flag\x1b[0m'), 'log.debug should output purple text when VIBEC_DEBUG=1');
  } finally {
    // Restore the original logger
    log.logger = originalLogger;
    delete process.env.VIBEC_DEBUG;
  }
});

// Helper to create a temporary test directory
async function createTempTestDir() {
  const tempDir = path.join(os.tmpdir(), `vibec-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  await fs.mkdir(tempDir, { recursive: true });
  
  // Create necessary subdirectories
  await fs.mkdir(path.join(tempDir, 'stacks', 'test-stack'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'output', 'current'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'output', 'stacks', 'test-stack'), { recursive: true });
  
  return tempDir;
}

// Helper to check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

tape('CLI argument parsing', async (t) => {
  // Test stacks argument
  const argsWithStacks = ['node', 'vibec.js', '--stacks=core,tests'];
  const optsWithStacks = parseArgs(argsWithStacks);
  t.deepEqual(optsWithStacks.stacks, ['core', 'tests'], 'Should parse comma-separated stacks');
  
  // Test dry-run flag
  const argsWithDryRun = ['node', 'vibec.js', '--dry-run'];
  const optsWithDryRun = parseArgs(argsWithDryRun);
  t.true(optsWithDryRun.dryRun, 'Should set dryRun to true with --dry-run flag');
  
  // Test no-overwrite flag
  const argsWithNoOverwrite = ['node', 'vibec.js', '--no-overwrite'];
  const optsWithNoOverwrite = parseArgs(argsWithNoOverwrite);
  t.true(optsWithNoOverwrite.noOverwrite, 'Should set noOverwrite to true with --no-overwrite flag');
  
  // Test multiple flags
  const argsWithMultipleFlags = ['node', 'vibec.js', '--stacks=core', '--dry-run', '--no-overwrite'];
  const optsWithMultipleFlags = parseArgs(argsWithMultipleFlags);
  t.deepEqual(optsWithMultipleFlags.stacks, ['core'], 'Should parse stacks correctly');
  t.true(optsWithMultipleFlags.dryRun, 'Should set dryRun to true');
  t.true(optsWithMultipleFlags.noOverwrite, 'Should set noOverwrite to true');
});

tape('Static plugin (.md) integration', async (t) => {
  // Create a mock server
  let server;
  let tempDir;
  
  try {
    tempDir = await createTempTestDir();
    
    // Create plugin directory and test static plugin
    const pluginsDir = path.join(tempDir, 'stacks', 'test-stack', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    
    // Create a static plugin
    await fs.writeFile(
      path.join(pluginsDir, 'test-plugin.md'),
      '## Test Plugin Content\nThis is a test plugin.'
    );
    
    // Create a prompt file
    await fs.writeFile(
      path.join(tempDir, 'stacks', 'test-stack', '001_test.md'),
      '# Test Prompt\n\n## Output: test.js'
    );
    
    // Set up a mock server to respond to chat completions
    server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          // Check if the request contains the plugin content
          const hasPluginContent = body.includes('Test Plugin Content');
          
          const responseObj = {
            choices: [
              {
                message: {
                  content: 'File: test.js\n```js\nconsole.log("mock")\n```'
                }
              }
            ]
          };
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(responseObj));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    server.listen(3000);
    
    // Silence logs for this test
    const originalLogger = log.logger;
    log.logger = () => {};
    
    // Run vibec with the static plugin
    const args = [
      'node', 'vibec.js',
      '--api-url=http://localhost:3000',
      '--api-key=test-key',
      '--workdir=' + tempDir,
      '--stacks=test-stack',
      '--dry-run=false'
    ];
    
    await main(args);
    
    // Verify the output file was created
    const outputFile = path.join(tempDir, 'output', 'current', 'test.js');
    const exists = await fileExists(outputFile);
    t.true(exists, 'Output file should be created');
    
    if (exists) {
      const content = await fs.readFile(outputFile, 'utf8');
      t.equal(content, 'console.log("mock")', 'File content should match mock response');
    }
    
    // Restore the logger
    log.logger = originalLogger;
  } finally {
    // Clean up
    if (server) {
      server.close();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

tape('Dynamic plugin (.js) integration', async (t) => {
  let tempDir;
  
  try {
    tempDir = await createTempTestDir();
    
    // Create a dynamic plugin that returns a string
    const pluginsDir = path.join(tempDir, 'stacks', 'test-stack', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(pluginsDir, 'test-plugin.js'),
      `module.exports = async function(context) {
        return "test";
      }`
    );
    
    // Prepare context for plugin execution
    const context = {
      config: { pluginTimeout: 1000 },
      stack: 'test-stack',
      promptNumber: 1,
      promptContent: '# Test',
      workingDir: path.join(tempDir, 'output', 'current')
    };
    
    // Load and execute the dynamic plugins
    const plugins = await loadDynamicPlugins('test-stack', tempDir);
    t.equal(plugins.length, 1, 'Should load one dynamic plugin');
    t.equal(plugins[0].name, 'test-plugin.js', 'Plugin name should match');
    
    // Silence logs for this test
    const originalLogger = log.logger;
    log.logger = () => {};
    
    // Execute the plugin with the context
    await executeDynamicPlugins(plugins, context, 1000);
    
    // Restore the logger
    log.logger = originalLogger;
    
    t.pass('Dynamic plugin executed without errors');
  } finally {
    // Clean up
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

tape('Dynamic plugin error handling', async (t) => {
  let tempDir;
  let logOutput = [];
  
  try {
    tempDir = await createTempTestDir();
    
    // Create a dynamic plugin that throws an error
    const pluginsDir = path.join(tempDir, 'stacks', 'test-stack', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(pluginsDir, 'error-plugin.js'),
      `module.exports = async function(context) {
        throw new Error('Test error');
      }`
    );
    
    // Prepare context for plugin execution
    const context = {
      config: { pluginTimeout: 1000 },
      stack: 'test-stack',
      promptNumber: 1,
      promptContent: '# Test',
      workingDir: path.join(tempDir, 'output', 'current')
    };
    
    // Capture log output
    const originalLogger = log.logger;
    log.logger = (...args) => {
      logOutput.push(args.join(' '));
    };
    
    // Load and execute the dynamic plugins
    const plugins = await loadDynamicPlugins('test-stack', tempDir);
    t.equal(plugins.length, 1, 'Should load one dynamic plugin');
    
    // Execute the plugin with the context
    await executeDynamicPlugins(plugins, context, 1000);
    
    // Check that error was logged
    const hasError = logOutput.some(msg => msg.includes('Error executing plugin') && msg.includes('Test error'));
    t.true(hasError, 'Error should be logged when plugin throws');
    
    // Restore the logger
    log.logger = originalLogger;
  } finally {
    // Clean up
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

tape('Plugin timeout', async (t) => {
  let tempDir;
  let logOutput = [];
  
  try {
    tempDir = await createTempTestDir();
    
    // Create a dynamic plugin that takes too long to execute
    const pluginsDir = path.join(tempDir, 'stacks', 'test-stack', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(pluginsDir, 'timeout-plugin.js'),
      `module.exports = async function(context) {
        return new Promise(resolve => setTimeout(resolve, 2000));
      }`
    );
    
    // Prepare context for plugin execution
    const context = {
      config: { pluginTimeout: 100 }, // Very short timeout
      stack: 'test-stack',
      promptNumber: 1,
      promptContent: '# Test',
      workingDir: path.join(tempDir, 'output', 'current')
    };
    
    // Capture log output
    const originalLogger = log.logger;
    log.logger = (...args) => {
      logOutput.push(args.join(' '));
    };
    
    // Load and execute the dynamic plugins
    const plugins = await loadDynamicPlugins('test-stack', tempDir);
    t.equal(plugins.length, 1, 'Should load one dynamic plugin');
    
    // Execute the plugin with a short timeout
    await executeDynamicPlugins(plugins, context, 100);
    
    // Check that timeout error was logged
    const hasTimeoutError = logOutput.some(msg => 
      msg.includes('Error executing plugin') && msg.includes('timed out'));
    t.true(hasTimeoutError, 'Timeout error should be logged when plugin takes too long');
    
    // Restore the logger
    log.logger = originalLogger;
  } finally {
    // Clean up
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

tape('Static plugin loading', async (t) => {
  let tempDir;
  
  try {
    tempDir = await createTempTestDir();
    
    // Create two static plugins
    const pluginsDir = path.join(tempDir, 'stacks', 'test-stack', 'plugins');
    await fs.mkdir(pluginsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(pluginsDir, '01-first.md'),
      '## First Plugin\nContent of first plugin'
    );
    
    await fs.writeFile(
      path.join(pluginsDir, '02-second.md'),
      '## Second Plugin\nContent of second plugin'
    );
    
    // Load the static plugins
    const plugins = await loadStaticPlugins('test-stack', tempDir);
    
    t.equal(plugins.length, 2, 'Should load two static plugins');
    t.equal(plugins[0].name, '01-first.md', 'First plugin name should match');
    t.equal(plugins[1].name, '02-second.md', 'Second plugin name should match');
    t.true(plugins[0].content.includes('First Plugin'), 'First plugin content should match');
    t.true(plugins[1].content.includes('Second Plugin'), 'Second plugin content should match');
  } finally {
    // Clean up
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});