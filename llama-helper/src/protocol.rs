use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum Request {
    Generate {
        prompt: String,
        max_tokens: Option<i32>,
        context_size: Option<u32>,
        model_path: Option<String>,
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        presence_penalty: Option<f32>,
        frequency_penalty: Option<f32>,
        repeat_penalty: Option<f32>,
        penalty_last_n: Option<i32>,
        stop_tokens: Option<Vec<String>>,
    },
    Ping,
    Shutdown,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum Response {
    #[serde(rename = "response")]
    GenerateResult {
        text: String,
        error: Option<String>,
    },
    Pong,
    Goodbye,
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SamplingConfig {
    pub(crate) temperature: f32,
    pub(crate) top_k: i32,
    pub(crate) top_p: f32,
    pub(crate) presence_penalty: f32,
    pub(crate) frequency_penalty: f32,
    pub(crate) repeat_penalty: f32,
    pub(crate) penalty_last_n: i32,
}

impl SamplingConfig {
    pub(crate) fn from_request(
        temperature: Option<f32>,
        top_k: Option<i32>,
        top_p: Option<f32>,
        presence_penalty: Option<f32>,
        frequency_penalty: Option<f32>,
        repeat_penalty: Option<f32>,
        penalty_last_n: Option<i32>,
    ) -> Self {
        let temperature = finite_or_default(temperature.unwrap_or(1.0), 0.0).max(0.0);
        let top_k = top_k.unwrap_or(64).max(1);
        let top_p = bounded_top_p(top_p.unwrap_or(0.95));
        let presence_penalty = finite_or_default(presence_penalty.unwrap_or(0.0), 0.0).max(0.0);
        let frequency_penalty = finite_or_default(frequency_penalty.unwrap_or(0.0), 0.0).max(0.0);
        let repeat_penalty = positive_or_default(repeat_penalty.unwrap_or(1.0), 1.0);
        let penalty_last_n = penalty_last_n.unwrap_or(0).max(0);

        Self {
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
        }
    }

    pub(crate) fn uses_penalties(&self) -> bool {
        self.penalty_last_n > 0
            && (self.presence_penalty > 0.0
                || self.frequency_penalty > 0.0
                || (self.repeat_penalty - 1.0).abs() > f32::EPSILON)
    }
}

fn finite_or_default(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

fn bounded_top_p(value: f32) -> f32 {
    if value.is_finite() && value > 0.0 && value <= 1.0 {
        value
    } else {
        1.0
    }
}

fn positive_or_default(value: f32, fallback: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_request_defaults_penalties_when_omitted() {
        let json =
            r#"{"type":"generate","prompt":"summarize","temperature":0.5,"top_k":20,"top_p":0.8}"#;
        let request: Request = serde_json::from_str(json).unwrap();
        let Request::Generate {
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
            ..
        } = request
        else {
            panic!("expected generate request");
        };

        let sampling = SamplingConfig::from_request(
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
        );

        assert_eq!(sampling.presence_penalty, 0.0);
        assert_eq!(sampling.frequency_penalty, 0.0);
        assert_eq!(sampling.repeat_penalty, 1.0);
        assert_eq!(sampling.penalty_last_n, 0);
        assert!(!sampling.uses_penalties());
    }

    #[test]
    fn generate_request_deserializes_qwen_penalties() {
        let json = r#"{"type":"generate","prompt":"summarize","temperature":0.5,"top_k":20,"top_p":0.8,"presence_penalty":0.3,"frequency_penalty":0.0,"repeat_penalty":1.05,"penalty_last_n":256}"#;
        let request: Request = serde_json::from_str(json).unwrap();
        let Request::Generate {
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
            ..
        } = request
        else {
            panic!("expected generate request");
        };

        let sampling = SamplingConfig::from_request(
            temperature,
            top_k,
            top_p,
            presence_penalty,
            frequency_penalty,
            repeat_penalty,
            penalty_last_n,
        );

        assert_eq!(sampling.temperature, 0.5);
        assert_eq!(sampling.top_k, 20);
        assert_eq!(sampling.top_p, 0.8);
        assert_eq!(sampling.presence_penalty, 0.3);
        assert_eq!(sampling.frequency_penalty, 0.0);
        assert_eq!(sampling.repeat_penalty, 1.05);
        assert_eq!(sampling.penalty_last_n, 256);
        assert!(sampling.uses_penalties());
    }
}
