import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Button } from "./button";

interface CopyButtonProps {
	value: string;
	className?: string;
}

/**
 * A button that copies text to clipboard and shows a checkmark for feedback.
 */
export function CopyButton({ value, className }: CopyButtonProps) {
	const [isCopied, setIsCopied] = useState(false);

	useEffect(() => {
		if (!isCopied) return;

		const timeout = setTimeout(() => {
			setIsCopied(false);
		}, 2000);

		return () => clearTimeout(timeout);
	}, [isCopied]);

	const handleCopy = () => {
		navigator.clipboard.writeText(value);
		setIsCopied(true);
	};

	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			onClick={handleCopy}
			title="Copy"
			className={className}
		>
			{isCopied ? (
				<IconCheck size={16} stroke={2} />
			) : (
				<IconCopy size={16} stroke={2} />
			)}
		</Button>
	);
}
