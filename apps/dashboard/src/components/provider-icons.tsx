import {
  SimpleIconSvg,
  SvgIcon,
  resolveSvgIconAccessibility,
} from "@onequery/ui/icons/svg-icon";
import type { IconSvgProps, SimpleIconData } from "@onequery/ui/icons/svg-icon";
import { IconHelpCircle } from "@tabler/icons-react";
import type { ComponentType } from "react";
import {
  siCloudflareworkers,
  siGithub,
  siGoogleanalytics,
  siGooglebigquery,
  siGoogledocs,
  siLinear,
  siMixpanel,
  siMongodb,
  siMysql,
  siPostgresql,
  siPosthog,
  siSentry,
  siSnowflake,
  siSupabase,
} from "simple-icons";

type ProviderIconProps = IconSvgProps;
type ProviderIconComponent = ComponentType<ProviderIconProps>;

function SimpleProviderIcon({
  icon,
  size = 24,
  ...props
}: ProviderIconProps & { icon: SimpleIconData }) {
  return <SimpleIconSvg {...props} icon={icon} size={size} />;
}

function createSimpleProviderIcon(icon: SimpleIconData): ProviderIconComponent {
  function SimpleIconComponent(props: ProviderIconProps) {
    return <SimpleProviderIcon {...props} icon={icon} />;
  }

  return SimpleIconComponent;
}

function AmplitudeIcon({ size = 24, ...props }: ProviderIconProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Amplitude"
      fill="currentColor"
      size={size}
      viewBox="0 0 40 40"
    >
      <path d="M17.6,9c-0.1-0.1-0.2-0.2-0.4-0.2c-0.1,0-0.2,0.1-0.3,0.1c-1.1,0.8-2.5,4.4-3.7,9l1.1,0c2.1,0,4.2,0,6.4,0.1 c-0.6-2.1-1.1-4-1.6-5.5C18.4,10.4,17.9,9.4,17.6,9z" />
      <path d="M20,0C9,0,0,9,0,20c0,11,9,20,20,20s20-9,20-20C40,9,31,0,20,0z M34.4,20.4C34.4,20.4,34.4,20.4,34.4,20.4 C34.4,20.4,34.3,20.4,34.4,20.4C34.3,20.4,34.3,20.4,34.4,20.4c-0.1,0.1-0.1,0.1-0.1,0.1c0,0,0,0,0,0c0,0,0,0,0,0 c-0.1,0.1-0.3,0.1-0.5,0.1c0,0-9.5,0-9.5,0c0.1,0.3,0.2,0.7,0.2,1.1c0.5,2.2,1.9,8.2,3.4,8.2l0,0l0,0l0,0c1.1,0,1.7-1.7,3-5.3l0,0 c0.2-0.6,0.4-1.2,0.7-1.9l0.1-0.2l0,0c0.1-0.2,0.2-0.3,0.4-0.3c0.3,0,0.5,0.2,0.5,0.5c0,0,0,0.1,0,0.1l0,0l-0.1,0.2 c-0.1,0.4-0.3,1-0.4,1.7c-0.8,3.2-1.9,7.9-4.9,7.9l0,0c-1.9,0-3.1-3.1-3.5-4.4c-0.9-2.4-1.6-5-2.3-7.6h-8.7l-1.8,5.8l0,0 c-0.2,0.3-0.5,0.4-0.8,0.4c-0.5,0-0.9-0.4-0.9-0.9l0,0l0.1-0.7c0.3-1.5,0.5-3,0.9-4.6H6.4l0,0c-0.7-0.1-1.2-0.7-1.2-1.4 c0-0.7,0.5-1.2,1.1-1.4c0.1,0,0.2,0,0.4,0c0.1,0,0.1,0,0.2,0c1.2,0,2.4,0,3.8,0.1c1.9-7.8,4.1-11.8,6.6-11.8c2.7,0,4.6,6,6.2,11.9 l0,0c3.2,0.1,6.7,0.2,10,0.4l0.1,0c0.1,0,0.1,0,0.2,0l0,0c0,0,0,0,0,0c0,0,0,0,0,0c0.5,0.1,0.8,0.5,0.8,1 C34.8,19.9,34.6,20.2,34.4,20.4z" />
    </SvgIcon>
  );
}

function LaminarIcon({ size = 24, ...props }: ProviderIconProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Laminar"
      fill="currentColor"
      size={size}
      viewBox="0 0 76 76"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.32507 73.4886C0.00220402 72.0863 0.0802819 69.9867 0.653968 68.1462C3.57273 58.7824 5.14534 48.8249 5.14534 38.5C5.14534 27.8899 3.48464 17.6677 0.408998 8.0791C-0.129499 6.40029 -0.266346 4.50696 0.811824 3.11199C2.27491 1.21902 4.56777 0 7.14535 0H37.1454C58.1322 0 75.1454 17.0132 75.1454 38C75.1454 58.9868 58.1322 76 37.1454 76H7.14535C4.85185 76 2.78376 75.0349 1.32507 73.4886Z"
      />
    </SvgIcon>
  );
}

// Source: https://icon.icepanel.io/AWS/svg/Analytics/Athena.svg via https://aws-icons.com/icons/athena
function AwsAthenaConnectorIcon({ size = 24, ...props }: ProviderIconProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="AWS Athena"
      fill="currentColor"
      size={size}
      viewBox="11 12 59 57"
    >
      <path d="M38.29505,27.2267312 C42.787319,27.2267312 45.2478437,28.2331825 45.6964751,28.7379193 C45.2478437,29.2426562 42.787319,30.2491074 38.29505,30.2491074 C33.8027811,30.2491074 31.3422564,29.2426562 30.893625,28.7379193 C31.3422564,28.2331825 33.8027811,27.2267312 38.29505,27.2267312 L38.29505,27.2267312 Z M37.7838882,35.2823712 C37.6191254,35.1977447 37.5029973,35.0294991 37.5029973,34.8300223 C37.5029973,34.5499487 37.7292981,34.3212556 38.0062188,34.3212556 C38.0866151,34.3212556 38.1600636,34.3444272 38.2285494,34.3796882 L37.7838882,35.2823712 Z M43.5674612,43.5908834 C43.4930201,43.6513309 43.322302,43.7681961 42.9709403,43.9092403 C42.6582879,44.0341652 42.2880677,44.1470006 41.8682202,44.2457316 C40.7525971,44.5076708 39.3808968,44.6517374 38.0052262,44.6517374 C34.9968155,44.6517374 32.9005556,44.0019265 32.4489466,43.5989431 L31.1159556,31.150783 C33.1596104,31.9869737 36.1700063,32.2640249 38.29505,32.2640249 C40.3843621,32.2640249 43.3292498,31.9950334 45.3719121,31.1910813 L44.5748967,36.6656121 C43.0731726,36.0994203 41.1992434,35.2773339 39.4235763,34.4129344 C39.2429327,33.786295 38.6801584,33.3248789 38.0062188,33.3248789 C37.1883598,33.3248789 36.5233532,34.0008837 36.5233532,34.8300223 C36.5233532,35.6611757 37.1883598,36.3361731 38.0062188,36.3361731 C38.1997655,36.3361731 38.3843793,36.2958747 38.5531123,36.2273675 C41.0344805,37.4524373 42.8835961,38.2382552 44.2751474,38.7228428 L43.5674612,43.5908834 Z M28.8718062,28.8467249 L30.4787403,43.8498003 C30.5918907,46.6344162 37.6995217,46.6666549 38.0052262,46.6666549 C39.5268012,46.6666549 41.0573091,46.5034466 42.3148665,46.2092686 C42.8299985,46.0883736 43.2964958,45.9453144 43.7004625,45.7831136 C44.8736534,45.3116229 45.4890327,44.6688642 45.5317122,43.8739793 L46.2006891,39.2759376 C46.6562683,39.3696313 47.0284735,39.4109371 47.3252452,39.4109371 C48.2592321,39.4109371 48.5053839,39.0281028 48.6751094,38.7641486 C48.853768,38.48609 48.9053804,38.1445615 48.8220064,37.8010181 C48.6314374,37.0111704 47.5168068,35.971473 46.7723963,35.3539008 L47.7133311,28.8850083 L47.7043982,28.8840008 C47.7083684,28.8346354 47.7242492,28.7882923 47.7242492,28.7379193 C47.7242492,25.9543109 41.7967568,25.2118138 38.29505,25.2118138 C34.7933433,25.2118138 28.8658509,25.9543109 28.8658509,28.7379193 C28.8658509,28.7751953 28.8787541,28.8084414 28.8807391,28.8457174 L28.8718062,28.8467249 Z M37.8355007,20.0596698 C46.4865427,20.0596698 53.5246954,27.2035597 53.5246954,35.98457 C53.5246954,44.7655803 46.4865427,51.9094701 37.8355007,51.9094701 C29.1834661,51.9094701 22.1453133,44.7655803 22.1453133,35.98457 C22.1453133,27.2035597 29.1834661,20.0596698 37.8355007,20.0596698 L37.8355007,20.0596698 Z M12.9850945,41.8348828 L12.9850945,43.8498003 L21.91802,43.8498003 L21.91802,43.7309201 C24.7735785,49.7494786 30.8261318,53.9243876 37.8355007,53.9243876 C47.5803298,53.9243876 55.50979,45.8768072 55.50979,35.98457 C55.50979,26.0923327 47.5803298,18.0447524 37.8355007,18.0447524 C30.253432,18.0447524 23.7909567,22.9248825 21.2857674,29.7453781 L12.9850945,29.7453781 L12.9850945,31.7602955 L20.6763434,31.7602955 C20.3666686,33.0568949 20.1850325,34.4018523 20.1701443,35.7901304 L11,35.7901304 L11,37.8050479 L20.2515331,37.8050479 C20.3914823,39.2044081 20.7061198,40.548358 21.1448257,41.8348828 L12.9850945,41.8348828 Z M67.0799136,66.035049 C65.8789314,67.2560889 63.7965672,67.2631412 62.5965775,66.046131 L51.9326496,55.220987 C53.6487638,53.9223727 55.1802643,52.3900279 56.4934043,50.6763406 L67.0918241,61.4853653 C67.688345,62.0918555 68.0168782,62.8998374 68.014902,63.7591997 C68.0139005,64.6205769 67.6823898,65.4275513 67.0799136,66.035049 L67.0799136,66.035049 Z M68.4972711,60.0628336 L57.6616325,49.0100039 C60.0635969,45.2562127 61.4650736,40.7851108 61.4650736,35.98457 C61.4650736,22.7586518 50.8646687,12 37.8355007,12 C28.4728022,12 19.9825528,17.6196048 16.2039254,26.316996 L18.0202869,27.1290077 C21.4812992,19.1630316 29.2588997,14.0149175 37.8355007,14.0149175 C49.7708816,14.0149175 59.4799791,23.8698788 59.4799791,35.98457 C59.4799791,48.0982537 49.7708816,57.9542225 37.8355007,57.9542225 C29.8623684,57.9542225 22.5572205,53.5244265 18.7686675,46.3936336 L17.0217843,47.3507194 C21.1557437,55.1343455 29.1318536,59.9691399 37.8355007,59.9691399 C42.3912926,59.9691399 46.6483279,58.6503765 50.2602074,56.3735197 L61.1941082,67.4716851 C62.1648195,68.4569797 63.4561235,69 64.8278238,69 C66.2074645,69 67.5067089,68.4529499 68.4813903,67.462618 C69.4580568,66.4773233 69.9980025,65.1635972 70,63.7622221 C70.0029653,62.3628619 69.4679823,61.0491357 68.4972711,60.0628336 L68.4972711,60.0628336 Z" />
    </SvgIcon>
  );
}

// Source: https://cf-icons.pages.dev/d1.svg via https://cf-icons.pages.dev/
function CloudflareD1Icon({ size = 24, ...props }: ProviderIconProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Cloudflare D1"
      size={size}
      viewBox="0 0 16 16"
    >
      <path
        d="m2.207 2.381 1.687-1.284L4.21 1h7.604l.313.102 1.736 1.285.215.423v9.98l-.145.362-1.268 1.343-.384.165H3.967l-.36-.142-1.439-1.342L2 12.79V2.81l.207-.429Zm.844 6.674 1.174 1.298h.014v1.05h-.48l-.708-.788v1.941l1.118 1.05h7.88l.972-1.026v-2.028l-.964.851H7.16v-1.05h4.505l1.363-1.211V7.188l-.964.853H7.16v-1.05h4.505l1.363-1.208V3.965l-.964.856H3.77l-.72-.735v1.607l1.175 1.298h.014v1.05h-.48l-.708-.788v1.802Zm8.59-7.004H4.388l-1.069.816.893.914h7.454l1.05-.935-1.073-.795Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path
        d="M5.7 8.452a.788.788 0 1 1 0 1.576.788.788 0 0 1 0-1.576Zm-.93 3.858.93-.929.928.929-.929.928-.928-.928Zm.93-7.05.796.46v.92l-.797.46-.796-.46v-.92l.796-.46Z"
        fill="currentColor"
      />
    </SvgIcon>
  );
}

function UnknownProviderIcon({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  role,
  size = 24,
  title,
  ...props
}: ProviderIconProps) {
  const accessibility = resolveSvgIconAccessibility({
    ariaHidden,
    ariaLabel,
    ariaLabelledBy: props["aria-labelledby"],
    defaultLabel: "Unknown provider",
    role,
    title,
  });

  return (
    <IconHelpCircle
      {...props}
      aria-hidden={accessibility.hidden ? true : undefined}
      aria-label={accessibility.label}
      aria-labelledby={accessibility.labelledBy}
      role={accessibility.role}
      size={size}
      stroke={2}
    />
  );
}

export const GitHubIcon = createSimpleProviderIcon(siGithub);

export const ProviderIcons = {
  amplitude: AmplitudeIcon,
  aws_athena_connector: AwsAthenaConnectorIcon,
  bigquery: createSimpleProviderIcon(siGooglebigquery),
  cloudflare_d1: CloudflareD1Icon,
  cloudflare_workers_observability:
    createSimpleProviderIcon(siCloudflareworkers),
  ga: createSimpleProviderIcon(siGoogleanalytics),
  github: GitHubIcon,
  google_docs: createSimpleProviderIcon(siGoogledocs),
  laminar: LaminarIcon,
  linear: createSimpleProviderIcon(siLinear),
  mixpanel: createSimpleProviderIcon(siMixpanel),
  mongodb: createSimpleProviderIcon(siMongodb),
  mysql: createSimpleProviderIcon(siMysql),
  postgres: createSimpleProviderIcon(siPostgresql),
  supabase: createSimpleProviderIcon(siSupabase),
  posthog: createSimpleProviderIcon(siPosthog),
  sentry: createSimpleProviderIcon(siSentry),
  snowflake: createSimpleProviderIcon(siSnowflake),
} as const satisfies Record<string, ProviderIconComponent>;

function hasProviderIcon(
  provider: string
): provider is keyof typeof ProviderIcons {
  return provider in ProviderIcons;
}

export function getProviderIcon(provider: string): ProviderIconComponent {
  if (hasProviderIcon(provider)) {
    return ProviderIcons[provider];
  }
  return UnknownProviderIcon;
}
