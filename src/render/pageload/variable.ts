import { MagicDialogHandle, uniqueVarName } from '../../render/browser.js';
import { CompletionTrigger, CompletionTriggerInitOptions } from './abstract.js';
import { CompletionType } from './config.js';

export class VariableCompletionTrigger extends CompletionTrigger {
  private _varName: string;
  private _promiseKey: string;
  private _magicDialog?: MagicDialogHandle;

  public constructor(varName: string) {
    super();
    this._varName = varName;
    this._promiseKey = uniqueVarName('variable');
  }

  private get _browserJs() {
    return this._options.browserJs;
  }

  public async init(options: Readonly<CompletionTriggerInitOptions>) {
    super.init(options);

    this._magicDialog = this._options.dialogHandler.registerMagicDialog();

    const { Page } = this._client;
    const varJs = JSON.stringify(this._varName);

    await Page.addScriptToEvaluateOnNewDocument({
      source: `(() => {
  if (self !== top) {
    return;
  }
  const promise = new Promise(resolve => {
    let value = false;
    let resolved = false;
    Object.defineProperty(window, ${varJs}, {
      set: val => {
        value = val;
        if (value === true && !resolved) {
          ${this._browserJs.saveHtmlResult}
          resolved = true;
          resolve();
        }
      },
      get: () => val,
    });
  });
  ${this._browserJs.set(this._promiseKey, 'promise')}
  ${this._magicDialog.js}
})()`,
    });
  }

  public async wait() {
    const { Runtime } = this._client;

    await this._magicDialog!.promise;

    const result = await Runtime.evaluate({
      awaitPromise: true,
      expression: `(async () => {
  const promise = ${this._browserJs.get(this._promiseKey)};
  if (!promise) {
    throw new Error('Promise not set.');
  }
  await promise;
  return true;
})()`,
    });

    if (result.exceptionDetails) {
      throw new Error(`Unable to await variable: ${result.exceptionDetails.text}`);
    }

    return CompletionType.Variable;
  }

  public async close() {
    if (this._magicDialog) {
      this._magicDialog.close();
    }
    super.close();
  }
}
