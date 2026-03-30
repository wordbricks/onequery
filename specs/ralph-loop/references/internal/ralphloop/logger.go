package ralphloop

import (
	"fmt"
	"io"
)

func logInfo(stream io.Writer, message string) {
	if stream == nil {
		return
	}
	_, _ = fmt.Fprintf(stream, "[info] %s\n", message)
}

func logWarn(stream io.Writer, message string) {
	if stream == nil {
		return
	}
	_, _ = fmt.Fprintf(stream, "[warn] %s\n", message)
}

func logError(stream io.Writer, message string) {
	if stream == nil {
		return
	}
	_, _ = fmt.Fprintf(stream, "[error] %s\n", message)
}
