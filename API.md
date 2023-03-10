# Prenda API

## POST /render

Load the requested page and return its HTML content.

```
Accept: application/json
Content-Type: application/json
```

### Request Body (object):

|Property|Type|Required|Default|Description|
|-|-|-|-|-|
|url|string|yes||The URL of the webpage to render.|
|completionTrigger|CompletionTrigger|no|RequestsCompletionTrigger&nbsp;¹|Specifies the completion trigger that is used to determine when a page should be considered loaded.|
|pageLoadTimeoutMillis|integer|no|10000&nbsp;¹|The maximum time the page is allowed to load. If exceeded, an error is returned unless `allowPartialLoad` is set to `true`.|
|allowPartialLoad|boolean|no|false&nbsp;¹|If set to true, the HTML content of the page will be read even if the page load timeout is exceeded.|
|expectedStatusCodes|integer[]|no|null&nbsp;¹|Checks the The HTTP status codes of the initial request (not including redirects). If the code does not fall in this range, an error is returned. By default, all codes are considered valid.|
|browserWidth|integer|no|1920&nbsp;¹|Overrides the screen width as well as the inner width of the window.|
|browserHeight|integer|no|1080&nbsp;¹|Overrides the screen height as well as the inner height of the window.|
|freshBrowserContext|boolean|no|true&nbsp;¹|If true, create a fresh [browser context](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createBrowserContext), otherwise use the global context. Browser contexts are similar to incognito tabs but there can be more than one. This also disables the caching of assets across multiple renders.|
|scriptToEvaluateOnNewDocument|string|no|null&nbsp;¹|A custom JavaScript script that is evaluated in every frame of the page upon creation before any of the frame's own scripts are loaded. This also means that the script will be loaded in any iframes that are embedded on the page. See [Page.addScriptToEvaluateOnNewDocument](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument) for more details.|

¹ Default values are defined in the configuration and can be customized.

## Completion triggers

### Requests completion trigger (object)

Considers the page loaded when there are no new web requests being made.

|Property|Type|Required|Default|Description|
|-|-|-|-|-|
|type|"requests"|yes||Union discriminator.|
|waitAfterLastRequestMillis|integer|no|2000|The number of milliseconds to wait after the last request.|

<br>

### Variable completion trigger (object)

Considers the page loaded when a variable is set to `true`. Before any scripts of the page are run, the variable will already be defined using `Object.defineProperty` on the window object.

|Property|Type|Required|Default|Description|
|-|-|-|-|-|
|type|"variable"|yes||Union discriminator.|
|varName|string|no|"prerender_done"|The name of the global variable name.|

<br>

### Event completion trigger (object)

Considers the page loaded when a certain event is fired.

|Property|Type|Required|Default|Description|
|-|-|-|-|-|
|type|"event"|yes||Union discriminator.|
|target|string|no|"window"|The variable name of the event emitter.|
|eventName|string|no|"prerender_done"|The name of the event to listen to.|
