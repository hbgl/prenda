import { MagicDialogHandle, uniqueVarName } from '../../render/browser.js';
import { CompletionTrigger, CompletionTriggerInitOptions } from './abstract.js';
import { CompletionType } from './config.js';

export class EventCompletionTrigger extends CompletionTrigger {
  private _target: string;
  private _eventName: string;
  private _promiseKey: string;
  private _magicDialog?: MagicDialogHandle;

  public constructor(target: string, eventName: string) {
    super();
    this._target = target;
    this._eventName = eventName;
    this._promiseKey = uniqueVarName('event');
  }

  private get _browserJs() {
    return this._options.browserJs;
  }

  public async init(options: CompletionTriggerInitOptions) {
    super.init(options);

    this._magicDialog = this._options.dialogHandler.registerMagicDialog();

    const { Page } = this._client;
    const targetKeyJs = JSON.stringify(this._target);
    const eventNameJs = JSON.stringify(this._eventName);

    await Page.addScriptToEvaluateOnNewDocument({
      source: `(() => {
  if (self !== top) {
    return;
  }
  const promise = new Promise(resolve => {
    let resolved = false;
    window[${targetKeyJs}].addEventListener(${eventNameJs}, () => {
      if (!resolved) {
        ${this._browserJs.saveHtmlResult}
        resolved = true;
        resolve();
      }
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
      throw new Error(`Unable to await event: ${result.exceptionDetails.text}`);
    }

    return CompletionType.Event;
  }

  public async close() {
    if (this._magicDialog) {
      this._magicDialog.close();
    }
    super.close();
  }
}
