Generate a Node.js script with the following content:

# Conventions:
- Start with shebang: #!/usr/bin/env node
- Import fs.promises, path, https, and child_process.execSync
- Include `console.log` statements to indicate progress and errors.
- Export all functions explicitly
- Don't use `process.exit` to handle errors inside of functions, throw exceptions instead.
- Use ES6+ syntax with async/await and import/export.
- Avoid dependencies on external libraries like `openai`: just use `fetch` to make HTTP requests.

# Functions:

## parseArgs
- parse CLI args with the following options:
  - `--workdir=<dir>`: Working directory (e.g., `custom_workdir`). Default: `.`.
  - `--stacks`: Comma-separated list of stacks to process (default: `['core']`)
  - `--dry-run`: Boolean flag to enable dry-run mode (default: `false`)
  - `--start`: Numeric value specifying the starting stage (default: `null`)
  - `--end`: Numeric value specifying the ending stage (default: `null`)
  - `--api-url`: URL of the LLM API to query (default: 'https://openrouter.ai/api/v1')
  - `--api-key`: API key for LLM API authentication
  - `--api-model`: API model to use for LLM queries (default: 'anthropic/claude-3.7-sonnet')
  - `--test-cmd`: Command to execute tests after processing (default: `null`)
  - it should take `process.argv` as an argument and return an object with the parsed options
  - support both --option=value and --option value syntax
  - for boolean flags, it should be true if the flag is present, false otherwise or if false is explicitly set, e.g. `--dry-run=false` or `--dry-run false`

## getPromptFiles
- Scan `stacks/<stack>` for `###_*.md` files from an array of stacks.
  - Return objects with:
    - `stack`: The name of the stack.
    - `file`: The file path.
    - `number`: Extracted numeric value from the file name.
  - Sort the returned objects by `number` in ascending order.

## buildPrompt
- read a file and append context from output/current/ using ## Context: file1, file2 syntax
- assemble prompt sandwich with:
  - system message
  - user message
  - context
  - system message
  - user message

## processLlm
  - Send the prompt to the LLM API at `${apiUrl}/chat/completions`. Do not use `new URL` to combine the URL.
  - Use native ES5 fetch API to send POST requests to LLM API
  - Include the system message:  
    'Generate code files in this exact format for each file: "File: path/to/file\n```lang\ncontent\n```". Ensure every response includes ALL files requested in the prompt’s ## Output: sections. Do not skip any requested outputs.'
  - In `--dry-run` mode, print the prompt to console and skip LLM API call. Instead always return the same response: 'File: example/file\n```lang\ncontent\n```'
  - Require an API key for authentication.
  - API model should be `anthropic/claude-3.7-sonnet` by default (pay attention to exact spelling)

## parseResponse
- extract files with regex /File: (.+?)\n```(?:\w+)?\n([\s\S]+?)\n```/g

## runTests 
- execute a testCmd if provided

## main
- orchestrate the following steps:
  - Take `process.argv` as an argument.
  - Parse CLI arguments using `parseArgs`.
  - Retrieve prompt files from all stacks specified in `--stacks` within the `--start` and `--end` range.
  - Build prompts for each file using `buildPrompt`.
  - Process prompts using `processLlm` to generate responses.
  - Parse responses using `parseResponse` to extract file content.
  - Before running any stage, reconstruct the `output/current/` directory:
    - initialize with `output/bootstrap/` files
    - copy generated files from the `output/stacks/` directory to match given `--start`. 
    - copy even stacks that are not in the `--stacks` argument
    - don't assume any directories exist, create them if needed
  - Write files to `output/stacks/<stack>/<prompt-file-name-without-md>/` and `output/current/` using `writeFiles` unless `--dry-run` is set.
  - Run tests using `runTests` if a `--testCmd` is provided.
  - Exit with an error code if any step fails.
- Wrap `main` in a `.catch` block to handle errors gracefully.
- Only execute `main` if the script is run directly (not imported as a module).

IMPORTANT: Output only the script content, nothing else.
