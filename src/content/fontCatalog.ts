/* Bundled fonts: latin + cyrillic subsets from @fontsource (SIL Open Font License). */
import nunitoLatin from '@fontsource/nunito/files/nunito-latin-900-normal.woff?url';
import nunitoCyrillic from '@fontsource/nunito/files/nunito-cyrillic-900-normal.woff?url';
import rubikLatin from '@fontsource/rubik/files/rubik-latin-800-normal.woff?url';
import rubikCyrillic from '@fontsource/rubik/files/rubik-cyrillic-800-normal.woff?url';
import unboundedLatin from '@fontsource/unbounded/files/unbounded-latin-800-normal.woff?url';
import unboundedCyrillic from '@fontsource/unbounded/files/unbounded-cyrillic-800-normal.woff?url';
import montserratLatin from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff?url';
import montserratCyrillic from '@fontsource/montserrat/files/montserrat-cyrillic-900-normal.woff?url';
import russoOneLatin from '@fontsource/russo-one/files/russo-one-latin-400-normal.woff?url';
import russoOneCyrillic from '@fontsource/russo-one/files/russo-one-cyrillic-400-normal.woff?url';
import delaGothicOneLatin from '@fontsource/dela-gothic-one/files/dela-gothic-one-latin-400-normal.woff?url';
import delaGothicOneCyrillic from '@fontsource/dela-gothic-one/files/dela-gothic-one-cyrillic-400-normal.woff?url';
import rubikMonoOneLatin from '@fontsource/rubik-mono-one/files/rubik-mono-one-latin-400-normal.woff?url';
import rubikMonoOneCyrillic from '@fontsource/rubik-mono-one/files/rubik-mono-one-cyrillic-400-normal.woff?url';
import oswaldLatin from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import oswaldCyrillic from '@fontsource/oswald/files/oswald-cyrillic-700-normal.woff?url';
import comfortaaLatin from '@fontsource/comfortaa/files/comfortaa-latin-700-normal.woff?url';
import comfortaaCyrillic from '@fontsource/comfortaa/files/comfortaa-cyrillic-700-normal.woff?url';
import lobsterLatin from '@fontsource/lobster/files/lobster-latin-400-normal.woff?url';
import lobsterCyrillic from '@fontsource/lobster/files/lobster-cyrillic-400-normal.woff?url';
import pacificoLatin from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import pacificoCyrillic from '@fontsource/pacifico/files/pacifico-cyrillic-400-normal.woff?url';
import caveatLatin from '@fontsource/caveat/files/caveat-latin-700-normal.woff?url';
import caveatCyrillic from '@fontsource/caveat/files/caveat-cyrillic-700-normal.woff?url';
import pressStart2pLatin from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff?url';
import pressStart2pCyrillic from '@fontsource/press-start-2p/files/press-start-2p-cyrillic-400-normal.woff?url';

export interface BundledFont {
  id: string;
  label: string;
  family: string;
  weight: number;
  files: string[];
}

export const BUNDLED_FONTS: BundledFont[] = [
  { id: 'nunito', label: 'Nunito Black', family: 'Nunito', weight: 900, files: [nunitoLatin, nunitoCyrillic] },
  { id: 'rubik', label: 'Rubik', family: 'Rubik', weight: 800, files: [rubikLatin, rubikCyrillic] },
  { id: 'unbounded', label: 'Unbounded', family: 'Unbounded', weight: 800, files: [unboundedLatin, unboundedCyrillic] },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', weight: 900, files: [montserratLatin, montserratCyrillic] },
  { id: 'russo-one', label: 'Russo One', family: 'Russo One', weight: 400, files: [russoOneLatin, russoOneCyrillic] },
  { id: 'dela-gothic-one', label: 'Dela Gothic', family: 'Dela Gothic One', weight: 400, files: [delaGothicOneLatin, delaGothicOneCyrillic] },
  { id: 'rubik-mono-one', label: 'Rubik Mono', family: 'Rubik Mono One', weight: 400, files: [rubikMonoOneLatin, rubikMonoOneCyrillic] },
  { id: 'oswald', label: 'Oswald', family: 'Oswald', weight: 700, files: [oswaldLatin, oswaldCyrillic] },
  { id: 'comfortaa', label: 'Comfortaa', family: 'Comfortaa', weight: 700, files: [comfortaaLatin, comfortaaCyrillic] },
  { id: 'lobster', label: 'Lobster', family: 'Lobster', weight: 400, files: [lobsterLatin, lobsterCyrillic] },
  { id: 'pacifico', label: 'Pacifico', family: 'Pacifico', weight: 400, files: [pacificoLatin, pacificoCyrillic] },
  { id: 'caveat', label: 'Caveat', family: 'Caveat', weight: 700, files: [caveatLatin, caveatCyrillic] },
  { id: 'press-start-2p', label: 'Press Start', family: 'Press Start 2P', weight: 400, files: [pressStart2pLatin, pressStart2pCyrillic] },
];
