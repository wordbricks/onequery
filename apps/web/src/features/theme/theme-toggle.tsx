import { Button } from "@onequery/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@onequery/ui/components/dropdown-menu";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="Toggle theme"
      >
        <IconSun
          size={16}
          stroke={2}
          className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
        />
        <IconMoon
          size={16}
          stroke={2}
          className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <IconSun size={16} stroke={2} className="mr-2" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <IconMoon size={16} stroke={2} className="mr-2" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <IconDeviceDesktop size={16} stroke={2} className="mr-2" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
