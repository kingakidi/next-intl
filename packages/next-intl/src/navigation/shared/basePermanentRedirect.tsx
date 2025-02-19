import {permanentRedirect as nextPermanentRedirect} from 'next/navigation';
import {
  AllLocales,
  LocalePrefix,
  ParametersExceptFirst
} from '../../shared/types';
import {prefixPathname} from '../../shared/utils';

export default function basePermanentRedirect(
  params: {
    pathname: string;
    locale: AllLocales[number];
    localePrefix?: LocalePrefix;
  },
  ...args: ParametersExceptFirst<typeof nextPermanentRedirect>
) {
  const localizedPathname =
    params.localePrefix === 'never'
      ? params.pathname
      : prefixPathname(params.locale, params.pathname);
  return nextPermanentRedirect(localizedPathname, ...args);
}
