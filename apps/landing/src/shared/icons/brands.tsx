import { SimpleIconSvg, SvgIcon } from "@onequery/ui/icons/svg-icon";
import type { IconSvgProps, SimpleIconData } from "@onequery/ui/icons/svg-icon";
import type { ComponentType } from "react";
import {
  siAirtable,
  siBun,
  siCaldotcom,
  siCloudflareworkers,
  siConfluence,
  siCurl,
  siDiscord,
  siGithub,
  siGoogleanalytics,
  siGooglebigquery,
  siGoogledrive,
  siGooglesearchconsole,
  siHomebrew,
  siJira,
  siLinear,
  siMixpanel,
  siMongodb,
  siMysql,
  siNotion,
  siNpm,
  siPostgresql,
  siPosthog,
  siSentry,
  siSnowflake,
  siSupabase,
  siTiktok,
  siVercel,
} from "simple-icons";

type BrandIconComponent = ComponentType<IconSvgProps>;

function createSimpleBrandIcon(icon: SimpleIconData): BrandIconComponent {
  function SimpleBrandIcon(props: IconSvgProps) {
    return <SimpleIconSvg {...props} icon={icon} />;
  }

  return SimpleBrandIcon;
}

function AmplitudeIcon({ size, ...props }: IconSvgProps) {
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

function LaminarIcon({ size, ...props }: IconSvgProps) {
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

function AwsAthenaConnectorIcon({ size, ...props }: IconSvgProps) {
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

function MotherDuckIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="MotherDuck"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M12 3C7.03 3 3 4.57 3 6.5v11C3 19.43 7.03 21 12 21s9-1.57 9-3.5v-11C21 4.57 16.97 3 12 3Zm0 2c4.42 0 7 1.24 7 1.5S16.42 8 12 8 5 6.76 5 6.5 7.58 5 12 5Zm7 5.07c-1.62 1.08-4.22 1.68-7 1.68s-5.38-.6-7-1.68V8.93c1.62.69 4.01 1.07 7 1.07s5.38-.38 7-1.07v1.14Zm0 3.5c-1.62 1.08-4.22 1.68-7 1.68s-5.38-.6-7-1.68v-1.14c1.62.69 4.01 1.07 7 1.07s5.38-.38 7-1.07v1.14Zm-7 5.68c-4.42 0-7-1.24-7-1.75v-1.57c1.62 1.08 4.22 1.68 7 1.68s5.38-.6 7-1.68v1.57c0 .51-2.58 1.75-7 1.75Z" />
    </SvgIcon>
  );
}

function GranolaIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Granola"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M6.75 3A2.75 2.75 0 0 0 4 5.75v12.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25V5.75A2.75 2.75 0 0 0 17.25 3H6.75ZM6 5.75c0-.41.34-.75.75-.75H8v14H6.75a.75.75 0 0 1-.75-.75V5.75ZM10 19V5h7.25c.41 0 .75.34.75.75v12.5c0 .41-.34.75-.75.75H10Zm2-10a1 1 0 0 1 1-1h2.75a1 1 0 1 1 0 2H13a1 1 0 0 1-1-1Zm0 4a1 1 0 0 1 1-1h2.75a1 1 0 1 1 0 2H13a1 1 0 0 1-1-1Z" />
    </SvgIcon>
  );
}

function MicrosoftClarityIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Microsoft Clarity"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M4.5 4A2.5 2.5 0 0 0 2 6.5v11A2.5 2.5 0 0 0 4.5 20h15a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 19.5 4h-15Zm0 2h15a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-15a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Zm3.25 3A1.25 1.25 0 0 0 6.5 10.25v4.5a1.25 1.25 0 1 0 2.5 0v-4.5A1.25 1.25 0 0 0 7.75 9Zm4.25-1a1.25 1.25 0 0 0-1.25 1.25v5.5a1.25 1.25 0 1 0 2.5 0v-5.5A1.25 1.25 0 0 0 12 8Zm4.25 3a1.25 1.25 0 0 0-1.25 1.25v2.5a1.25 1.25 0 1 0 2.5 0v-2.5A1.25 1.25 0 0 0 16.25 11Z" />
    </SvgIcon>
  );
}

function AmazonAdsIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Amazon Ads"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M12.2 3.5a1 1 0 0 1 .93.63l5.5 14a1 1 0 0 1-1.86.74L15.6 15.9H8.4l-1.17 2.97a1 1 0 1 1-1.86-.74l5.5-14a1 1 0 0 1 .93-.63h.4Zm-3 10.4h5.6L12 6.77 9.2 13.9Zm9.95 4.88a1 1 0 0 1-.36 1.37c-3.77 2.16-8.38 2.16-12.15 0a1 1 0 0 1 1-1.73 10.2 10.2 0 0 0 10.15 0 1 1 0 0 1 1.36.36Z" />
    </SvgIcon>
  );
}

function LinkedInAdsIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="LinkedIn Ads"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M5.75 3A2.75 2.75 0 0 0 3 5.75v12.5A2.75 2.75 0 0 0 5.75 21h12.5A2.75 2.75 0 0 0 21 18.25V5.75A2.75 2.75 0 0 0 18.25 3H5.75Zm2.09 6.28a1.48 1.48 0 1 1 0-2.96 1.48 1.48 0 0 1 0 2.96ZM6.54 18v-7.45h2.6V18h-2.6Zm4.06 0v-7.45h2.48v1.02h.04c.35-.65 1.2-1.2 2.45-1.2 2.62 0 3.1 1.73 3.1 3.97V18h-2.59v-3.25c0-.78-.01-1.78-1.08-1.78-1.09 0-1.26.85-1.26 1.72V18H10.6Z" />
    </SvgIcon>
  );
}

function SendGridIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="SendGrid"
      fill="currentColor"
      size={size}
      viewBox="0 0 24 24"
    >
      <path d="M4.75 4A2.75 2.75 0 0 0 2 6.75v10.5A2.75 2.75 0 0 0 4.75 20h14.5A2.75 2.75 0 0 0 22 17.25V6.75A2.75 2.75 0 0 0 19.25 4H4.75Zm.36 2h13.78L12 11.17 5.11 6ZM4 7.6l5.35 4.02L4 16.15V7.6Zm2.08 10.4 4.9-4.16.42.32a1 1 0 0 0 1.2 0l.42-.32 4.9 4.16H6.08ZM20 16.15l-5.35-4.53L20 7.6v8.55Z" />
      <path d="M17.5 10.25a1 1 0 0 1 1 1v.5h.5a1 1 0 1 1 0 2h-.5v.5a1 1 0 1 1-2 0v-.5H16a1 1 0 1 1 0-2h.5v-.5a1 1 0 0 1 1-1Z" />
    </SvgIcon>
  );
}

function SlackIcon({ size, ...props }: IconSvgProps) {
  return (
    <SvgIcon {...props} defaultLabel="Slack" size={size} viewBox="0 0 128 128">
      <path
        d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0"
        fill="#de1c59"
      />
      <path
        d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0"
        fill="#35c5f0"
      />
      <path
        d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0"
        fill="#2eb57d"
      />
      <path
        d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0"
        fill="#ebb02e"
      />
    </SvgIcon>
  );
}

function CloudflareD1Icon({ size, ...props }: IconSvgProps) {
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

const BRAND_ICONS = {
  amplitude: AmplitudeIcon,
  amazon_ads: AmazonAdsIcon,
  airtable: createSimpleBrandIcon(siAirtable),
  aws_athena_connector: AwsAthenaConnectorIcon,
  bigquery: createSimpleBrandIcon(siGooglebigquery),
  bun: createSimpleBrandIcon(siBun),
  cal: createSimpleBrandIcon(siCaldotcom),
  cloudflare_d1: CloudflareD1Icon,
  cloudflare_web_analytics: createSimpleBrandIcon(siCloudflareworkers),
  cloudflare_workers_observability: createSimpleBrandIcon(siCloudflareworkers),
  confluence: createSimpleBrandIcon(siConfluence),
  curl: createSimpleBrandIcon(siCurl),
  discord: createSimpleBrandIcon(siDiscord),
  ga: createSimpleBrandIcon(siGoogleanalytics),
  github: createSimpleBrandIcon(siGithub),
  googledrive: createSimpleBrandIcon(siGoogledrive),
  google_search_console: createSimpleBrandIcon(siGooglesearchconsole),
  granola: GranolaIcon,
  homebrew: createSimpleBrandIcon(siHomebrew),
  jira: createSimpleBrandIcon(siJira),
  laminar: LaminarIcon,
  linear: createSimpleBrandIcon(siLinear),
  linkedin_ads: LinkedInAdsIcon,
  microsoft_clarity: MicrosoftClarityIcon,
  mixpanel: createSimpleBrandIcon(siMixpanel),
  motherduck: MotherDuckIcon,
  mongodb: createSimpleBrandIcon(siMongodb),
  mysql: createSimpleBrandIcon(siMysql),
  notion: createSimpleBrandIcon(siNotion),
  npm: createSimpleBrandIcon(siNpm),
  postgresql: createSimpleBrandIcon(siPostgresql),
  postgres: createSimpleBrandIcon(siPostgresql),
  posthog: createSimpleBrandIcon(siPosthog),
  sentry: createSimpleBrandIcon(siSentry),
  sendgrid: SendGridIcon,
  slack: SlackIcon,
  snowflake: createSimpleBrandIcon(siSnowflake),
  supabase: createSimpleBrandIcon(siSupabase),
  tiktok_marketing: createSimpleBrandIcon(siTiktok),
  vercel: createSimpleBrandIcon(siVercel),
} as const satisfies Record<string, BrandIconComponent>;

export type BrandIconName = keyof typeof BRAND_ICONS;

type BrandIconProps = IconSvgProps & {
  name: BrandIconName;
};

export function hasBrandIcon(name: string): name is BrandIconName {
  return name in BRAND_ICONS;
}

export function BrandIcon({ name, ...props }: BrandIconProps) {
  const Icon = BRAND_ICONS[name];

  return <Icon {...props} />;
}
