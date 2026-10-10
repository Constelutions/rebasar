use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use rebasar_core::github::{HttpClient, HttpRequest, UreqHttpClient};

#[test]
fn the_http_client_posts_json_with_the_bearer_token_and_returns_the_answer() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let url = format!("http://{}/graphql", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut received = Vec::new();
        let mut buffer = [0u8; 1024];
        while !String::from_utf8_lossy(&received).contains("{\"query\":1}") {
            let read = stream.read(&mut buffer).expect("read");
            received.extend_from_slice(&buffer[..read]);
        }
        let reply = "{\"ok\":true}";
        write!(
            stream,
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
            reply.len()
        )
        .expect("reply");
        String::from_utf8(received).unwrap()
    });

    let response = UreqHttpClient::new()
        .post_json(&HttpRequest {
            url,
            bearer_token: "secret-token".to_owned(),
            body: "{\"query\":1}".to_owned(),
        })
        .expect("post");

    let received = server.join().unwrap().to_lowercase();
    assert!(received.starts_with("post /graphql"));
    assert!(received.contains("authorization: bearer secret-token"));
    assert!(received.contains("content-type: application/json"));
    assert_eq!(response.status, 401);
    assert_eq!(response.body, "{\"ok\":true}");
}
