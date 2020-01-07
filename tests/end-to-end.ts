import { promises, existsSync } from 'fs';
import { posix } from 'path';
import { load } from 'js-yaml';
import { SharedPromise } from './utils/SharedPromise';
import { fork } from 'child_process';

const { readFile } = promises;
const { join } = posix;

const distDir = join(__dirname, '..', 'dist');
const actionYmlFilename = join(distDir, 'action.yml');

describe('GitHub Actions Test', () => {
  test('action.yml exists', () => {
    expect(existsSync(actionYmlFilename)).toBe(true);
  });

  const actionYmlFileContents = SharedPromise<string>();

  test('can read action.yml', async () => {
    try {
      const contents = (await readFile(actionYmlFilename)).toString();
      actionYmlFileContents.resolve(contents);

      expect(typeof contents).toBe('string');

      expect(contents.length).toBeGreaterThan(0);
    } catch (e) {
      actionYmlFileContents.reject(e);
      throw e;
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const action = SharedPromise<any>();

  test('action.yml has valid yaml', async () => {
    try {
      const contents = load(await actionYmlFileContents.promise);

      action.resolve(contents);

      expect(typeof contents).toBe('object');
    } catch (e) {
      action.reject(e);
      throw e;
    }
  });

  test('action.yml has correct runs.using', async () => {
    const contents = await action.promise;

    expect((contents.runs.using as string).substr(0, 4)).toBe('node');
  });

  const mainDone = SharedPromise();

  const list = [
    ['main'],
    // ['post'],
  ];

  describe.each(list)('Test script execution [runs.%s]', which => {
    const execFilename = SharedPromise<string>();

    if (which === 'main') execFilename.promise.catch(mainDone.reject);

    test(`action.yml has runs.${which}`, async () => {
      try {
        if (which === 'post') await mainDone.promise;

        const contents = await action.promise;

        const val = contents.runs[which];

        expect(typeof val).toBe('string');

        execFilename.resolve(join(distDir, val));
      } catch (e) {
        execFilename.reject(e);
        throw e;
      }
    });

    test(`runs.${which} exists`, async () => {
      expect(existsSync(await execFilename.promise)).toBe(true);
    });

    const executionResult = SharedPromise<string>();

    test(`can run runs.${which}`, async () => {
      try {
        let messages = '';

        const exec = fork(await execFilename.promise, [], {
          env: {
            INPUT_BRANCH: 'test-dummy',
            'INPUT_working-directory': 'test-dummy',
          },
          silent: true,
        });

        exec.stdout?.on('data', m => (messages += `stdout > ${m}`));
        exec.stderr?.on('data', m => (messages += `stderr > ${m}`));

        exec.on('error', executionResult.reject);

        exec.on('exit', exitCode => {
          if (exitCode === 0) executionResult.resolve(messages);
          else
            executionResult.reject(
              new Error(`Exit code: ${exitCode}\n${messages}`),
            );
        });

        await executionResult.promise.catch(() => {});
      } catch (e) {
        executionResult.reject(e);
        throw e;
      }
    });

    // eslint-disable-next-line @typescript-eslint/promise-function-async
    test(`runs.${which} runs without error`, () => executionResult.promise);

    test(`runs.${which} has expected output`, async () => {
      try {
        const output = await executionResult.promise;

        expect(output).toBe('foobar');

        if (which === 'main') mainDone.resolve();
      } catch (e) {
        if (which === 'main') mainDone.reject();
        throw e;
      }
    });
  });

  // TODO: Read action.yml and run main/post on dummy repo/dir
});
