export interface RoutedMessage {
  type: string;
  // Runtime messages are an open protocol shared by extension contexts.
  // Individual handlers validate fields they treat as untrusted.
  [key: string]: any;
}

type SendResponse = (response?: unknown) => void;
type MessageHandler = (
  message: RoutedMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
) => unknown | Promise<unknown>;

const handlers: Record<string, MessageHandler> = {};

export const registerMessage = (type: string, handler: MessageHandler): void => {
  if (handlers[type]) {
    console.warn(
      `⚠️ Handler for ${type} already exists in this context. Skipping.`
    );
    return;
  }
  handlers[type] = handler;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const messageDispatcher = (
  message: RoutedMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): true | void => {
  const handler = handlers[message.type];

  if (handler) {
    try {
      const result = handler(message, sender, sendResponse);

      if (result instanceof Promise) {
        result
          .then((response) => {
            sendResponse(response);
          })
          .catch((err) => {
            sendResponse({ error: errorMessage(err) });
          });

        return true;
      } else {
        sendResponse(result);
      }
    } catch (err) {
      sendResponse({ error: errorMessage(err) });
    }
  }
};

export const messageRouter = (): void => {
  const chromeApi = (globalThis as typeof globalThis & {
    chrome: {
      runtime: {
        onMessage: {
          addListener: (
            listener: (
              message: RoutedMessage,
              sender: chrome.runtime.MessageSender,
              sendResponse: SendResponse,
            ) => boolean | void,
          ) => void;
        };
      };
    };
  }).chrome;
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const result = messageDispatcher(message, sender, sendResponse);

    if (result === true) {
      return true;
    }
  });
};
