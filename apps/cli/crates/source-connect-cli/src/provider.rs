use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct SourceConnectProvider(String);

impl SourceConnectProvider {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[doc(hidden)]
    pub fn new_for_test(value: &str) -> Self {
        match value.parse() {
            Ok(provider) => provider,
            Err(error) => panic!("test provider values should be valid: {error}"),
        }
    }
}

impl fmt::Display for SourceConnectProvider {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for SourceConnectProvider {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("source provider must not be empty".to_owned());
        }

        Ok(Self(trimmed.to_owned()))
    }
}
