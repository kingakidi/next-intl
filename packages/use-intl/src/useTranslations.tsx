import IntlMessageFormat from 'intl-messageformat';
import {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  ReactNodeArray,
  useMemo,
  useRef
} from 'react';
import Formats from './Formats';
import GetDeepProperty from './GetDeepProperty';
import IntlError, {IntlErrorCode} from './IntlError';
import IntlMessages from './IntlMessages';
// The TypeScript parser for ESLint is currently unable to parse this file
// eslint-disable-next-line import/namespace, import/default, import/no-named-as-default-member
import NestedKeyOf from './NestedKeyOf';
import TranslationValues, {RichTranslationValues} from './TranslationValues';
import convertFormatsToIntlMessageFormat from './convertFormatsToIntlMessageFormat';
import useIntlContext from './useIntlContext';

function resolvePath(
  messages: IntlMessages | undefined,
  idPath: string,
  namespace?: string
) {
  if (!messages) {
    throw new Error(
      __DEV__ ? `No messages available at \`${namespace}\`.` : undefined
    );
  }

  let message = messages;

  idPath.split('.').forEach((part) => {
    const next = (message as any)[part];

    if (part == null || next == null) {
      throw new Error(
        __DEV__
          ? `Could not resolve \`${idPath}\` in ${
              namespace ? `\`${namespace}\`` : 'messages'
            }.`
          : undefined
      );
    }

    message = next;
  });

  return message;
}

function prepareTranslationValues(values: RichTranslationValues) {
  if (Object.keys(values).length === 0) return undefined;

  // Workaround for https://github.com/formatjs/formatjs/issues/1467
  const transformedValues: RichTranslationValues = {};
  Object.keys(values).forEach((key) => {
    let index = 0;
    const value = values[key];

    let transformed;
    if (typeof value === 'function') {
      transformed = (children: ReactNode) => {
        const result = value(children);

        return isValidElement(result)
          ? cloneElement(result, {key: key + index++})
          : result;
      };
    } else {
      transformed = value;
    }

    transformedValues[key] = transformed;
  });

  return transformedValues;
}

// TODO: Move out and replace with a default interface that allows for any
// access. A consumer can optionally override the interface to provide type
// safety.
const exampleMessages = {foo: 'foo', bar: {a: 'Hello', b: {c: 'World'}}};
type Messages = typeof exampleMessages;

/**
 * Translates messages from the given namespace by using the ICU syntax.
 * See https://formatjs.io/docs/core-concepts/icu-syntax.
 *
 * If no namespace is provided, all available messages are returned.
 * The namespace can also indicate nesting by using a dot
 * (e.g. `namespace.Component`).
 */
export default function useTranslations<
  NestedKey extends NestedKeyOf<Messages>
>(namespace?: NestedKey) {
  const {
    defaultTranslationValues,
    formats: globalFormats,
    getMessageFallback,
    locale,
    messages: allMessages,
    onError,
    timeZone
  } = useIntlContext();

  const cachedFormatsByLocaleRef = useRef<
    Record<string, Record<string, IntlMessageFormat>>
  >({});

  const messagesOrError = useMemo(() => {
    try {
      if (!allMessages) {
        throw new Error(
          __DEV__ ? `No messages were configured on the provider.` : undefined
        );
      }

      const retrievedMessages = namespace
        ? resolvePath(allMessages, namespace)
        : allMessages;

      if (!retrievedMessages) {
        throw new Error(
          __DEV__
            ? `No messages for namespace \`${namespace}\` found.`
            : undefined
        );
      }

      return retrievedMessages;
    } catch (error) {
      const intlError = new IntlError(
        IntlErrorCode.MISSING_MESSAGE,
        (error as Error).message
      );
      onError(intlError);
      return intlError;
    }
  }, [allMessages, namespace, onError]);

  const translate = useMemo(() => {
    function getFallbackFromErrorAndNotify(
      key: string,
      code: IntlErrorCode,
      message?: string
    ) {
      const error = new IntlError(code, message);
      onError(error);
      return getMessageFallback({error, key, namespace});
    }

    function translateBaseFn(
      /** Use a dot to indicate a level of nesting (e.g. `namespace.nestedLabel`). */
      key: string,
      /** Key value pairs for values to interpolate into the message. */
      values?: RichTranslationValues,
      /** Provide custom formats for numbers, dates and times. */
      formats?: Partial<Formats>
    ): string | ReactElement | ReactNodeArray {
      const cachedFormatsByLocale = cachedFormatsByLocaleRef.current;

      if (messagesOrError instanceof IntlError) {
        // We have already warned about this during render
        return getMessageFallback({
          error: messagesOrError,
          key,
          namespace
        });
      }
      const messages = messagesOrError;

      const cacheKey = [namespace, key]
        .filter((part) => part != null)
        .join('.');

      let messageFormat;
      if (cachedFormatsByLocale[locale]?.[cacheKey]) {
        messageFormat = cachedFormatsByLocale[locale][cacheKey];
      } else {
        let message;
        try {
          message = resolvePath(messages, key, namespace);
        } catch (error) {
          return getFallbackFromErrorAndNotify(
            key,
            IntlErrorCode.MISSING_MESSAGE,
            (error as Error).message
          );
        }

        if (typeof message === 'object') {
          return getFallbackFromErrorAndNotify(
            key,
            IntlErrorCode.INSUFFICIENT_PATH,
            __DEV__
              ? `Insufficient path specified for \`${key}\` in \`${
                  namespace ? `\`${namespace}\`` : 'messages'
                }\`.`
              : undefined
          );
        }

        try {
          messageFormat = new IntlMessageFormat(
            message,
            locale,
            convertFormatsToIntlMessageFormat(
              {...globalFormats, ...formats},
              timeZone
            )
          );
        } catch (error) {
          return getFallbackFromErrorAndNotify(
            key,
            IntlErrorCode.INVALID_MESSAGE,
            (error as Error).message
          );
        }

        if (!cachedFormatsByLocale[locale]) {
          cachedFormatsByLocale[locale] = {};
        }
        cachedFormatsByLocale[locale][cacheKey] = messageFormat;
      }

      try {
        const formattedMessage = messageFormat.format(
          prepareTranslationValues({...defaultTranslationValues, ...values})
        );

        if (formattedMessage == null) {
          throw new Error(
            __DEV__
              ? `Unable to format \`${key}\` in ${
                  namespace ? `namespace \`${namespace}\`` : 'messages'
                }`
              : undefined
          );
        }

        // Limit the function signature to return strings or React elements
        return isValidElement(formattedMessage) ||
          // Arrays of React elements
          Array.isArray(formattedMessage) ||
          typeof formattedMessage === 'string'
          ? formattedMessage
          : String(formattedMessage);
      } catch (error) {
        return getFallbackFromErrorAndNotify(
          key,
          IntlErrorCode.FORMATTING_ERROR,
          (error as Error).message
        );
      }
    }

    function translateFn<
      TargetKey extends NestedKey extends undefined
        ? NestedKeyOf<Messages>
        : NestedKeyOf<GetDeepProperty<Messages, NestedKey>>
    >(
      /** Use a dot to indicate a level of nesting (e.g. `namespace.nestedLabel`). */
      key: TargetKey,
      /** Key value pairs for values to interpolate into the message. */
      values?: TranslationValues,
      /** Provide custom formats for numbers, dates and times. */
      formats?: Partial<Formats>
    ): string {
      const message = translateBaseFn(key, values, formats);

      if (typeof message !== 'string') {
        return getFallbackFromErrorAndNotify(
          key,
          IntlErrorCode.INVALID_MESSAGE,
          __DEV__
            ? `The message \`${key}\` in ${
                namespace ? `namespace \`${namespace}\`` : 'messages'
              } didn't resolve to a string. If you want to format rich text, use \`t.rich\` instead.`
            : undefined
        );
      }

      return message;
    }

    translateFn.rich = translateBaseFn;

    translateFn.raw = (
      /** Use a dot to indicate a level of nesting (e.g. `namespace.nestedLabel`). */
      key: string
    ): any => {
      if (messagesOrError instanceof IntlError) {
        // We have already warned about this during render
        return getMessageFallback({
          error: messagesOrError,
          key,
          namespace
        });
      }
      const messages = messagesOrError;

      try {
        return resolvePath(messages, key, namespace);
      } catch (error) {
        return getFallbackFromErrorAndNotify(
          key,
          IntlErrorCode.MISSING_MESSAGE,
          (error as Error).message
        );
      }
    };

    return translateFn;
  }, [
    getMessageFallback,
    globalFormats,
    locale,
    messagesOrError,
    namespace,
    onError,
    timeZone,
    defaultTranslationValues
  ]);

  return translate;
}
