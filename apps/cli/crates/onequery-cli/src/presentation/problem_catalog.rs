use crate::explain::ExplainCode;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct ApiProblemPresentation {
    pub(crate) title: &'static str,
    pub(crate) hint: Option<&'static str>,
    pub(crate) try_next: &'static [&'static str],
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct ProblemRecovery {
    hint: Option<&'static str>,
    try_next: &'static [&'static str],
}

const AUTH_LOGIN_TRY_NEXT: &[&str] = &["onequery auth login"];
const FORBIDDEN_TRY_NEXT: &[&str] = &["refresh your session and retry"];
const INVALID_REQUEST_TRY_NEXT: &[&str] = &["correct the request and retry"];
const SOURCE_LIST_TRY_NEXT: &[&str] = &["run `onequery source list`"];

pub(crate) fn api_problem_presentation(reason: &str) -> Option<ApiProblemPresentation> {
    let explanation = ExplainCode::from_problem_reason(reason)?.explanation();
    let recovery = problem_recovery(reason).unwrap_or(ProblemRecovery {
        hint: explanation.try_next.first().copied(),
        try_next: explanation.try_next,
    });

    Some(ApiProblemPresentation {
        title: explanation.title,
        hint: recovery.hint,
        try_next: recovery.try_next,
    })
}

fn problem_recovery(reason: &str) -> Option<ProblemRecovery> {
    match reason {
        "FORBIDDEN" => Some(ProblemRecovery {
            hint: Some("refresh your session and retry"),
            try_next: FORBIDDEN_TRY_NEXT,
        }),
        "AUTH_REQUEST_INVALID"
        | "SOURCE_REQUEST_INVALID"
        | "ORG_REQUEST_INVALID"
        | "READ_QUERY_INPUT_INVALID"
        | "EXECUTE_QUERY_REQUEST_INVALID"
        | "SOURCE_API_REQUEST_INVALID" => Some(ProblemRecovery {
            hint: Some("correct the request and retry"),
            try_next: INVALID_REQUEST_TRY_NEXT,
        }),
        "NOT_LOGGED_IN" => Some(ProblemRecovery {
            hint: Some("run `onequery auth login`"),
            try_next: AUTH_LOGIN_TRY_NEXT,
        }),
        "SOURCE_NOT_FOUND" => Some(ProblemRecovery {
            hint: Some("run `onequery source list`"),
            try_next: SOURCE_LIST_TRY_NEXT,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::ApiProblemPresentation;
    use super::api_problem_presentation;

    #[test]
    fn api_problem_presentation_uses_canonical_reason_catalog() {
        assert_eq!(
            api_problem_presentation("SOURCE_NOT_FOUND"),
            Some(ApiProblemPresentation {
                title: "Source Not Found",
                hint: Some("run `onequery source list`"),
                try_next: &["run `onequery source list`"],
            })
        );
    }

    #[test]
    fn api_problem_presentation_rejects_unknown_reasons() {
        assert_eq!(api_problem_presentation("SOURCE_MOVED_ELSEWHERE"), None);
    }
}
