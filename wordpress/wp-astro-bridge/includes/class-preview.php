<?php
/**
 * Preview URL rewriter — redirects WordPress preview to Astro frontend.
 *
 * @package WP_Astro_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WP_Astro_Bridge_Preview
 *
 * Filters preview_post_link to point to the Astro frontend with
 * a short-lived HMAC token for authentication.
 */
class WP_Astro_Bridge_Preview {

	/**
	 * Plugin options.
	 *
	 * @var array
	 */
	private $options;

	/**
	 * Constructor.
	 *
	 * @param array $options Plugin options from wp_astro_bridge_settings.
	 */
	public function __construct( $options ) {
		$this->options = $options;

		if ( empty( $this->options['astro_url'] ) ) {
			return;
		}

		add_filter( 'preview_post_link', array( $this, 'rewrite_preview_link' ), 10, 2 );
	}

	/**
	 * Rewrite the WordPress preview URL to point to the Astro frontend.
	 *
	 * @param string  $preview_link Default WordPress preview link.
	 * @param WP_Post $post         Post object.
	 * @return string Modified preview link pointing to Astro.
	 */
	public function rewrite_preview_link( $preview_link, $post ) {
		$post_type_obj = get_post_type_object( $post->post_type );
		if ( ! $post_type_obj || ! $post_type_obj->public ) {
			return $preview_link;
		}

		$token     = $this->generate_token( $post->ID );
		$astro_url = rtrim( $this->options['astro_url'], '/' );

		return add_query_arg(
			array(
				'token' => $token,
				'id'    => $post->ID,
			),
			$astro_url . '/preview'
		);
	}

	/**
	 * Generate a short-lived HMAC token for preview authentication.
	 *
	 * Token payload: post_id|user_id|expiry
	 * Signed with wp_salt('auth')
	 * Expires in 5 minutes.
	 *
	 * @param int $post_id Post ID to generate token for.
	 * @return string Base64-encoded token containing payload and signature.
	 */
	public function generate_token( $post_id ) {
		$user_id   = get_current_user_id();
		$expiry    = time() + ( 5 * MINUTE_IN_SECONDS );
		$payload   = $post_id . '|' . $user_id . '|' . $expiry;
		$signature = hash_hmac( 'sha256', $payload, wp_salt( 'auth' ) );

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return base64_encode( $payload . '|' . $signature );
	}

	/**
	 * Verify a preview token (used by the REST endpoint).
	 *
	 * @param string $token   Base64-encoded token.
	 * @param int    $post_id Expected post ID.
	 * @return true|WP_Error True if valid, WP_Error on failure.
	 */
	public static function verify_token( $token, $post_id ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$decoded = base64_decode( $token, true );
		if ( ! $decoded ) {
			return new WP_Error( 'invalid_token', 'Token is malformed.', array( 'status' => 403 ) );
		}

		$parts = explode( '|', $decoded );
		if ( count( $parts ) !== 4 ) {
			return new WP_Error( 'invalid_token', 'Token format is invalid.', array( 'status' => 403 ) );
		}

		list( $token_post_id, $token_user_id, $expiry, $signature ) = $parts;

		// Check expiry.
		if ( (int) $expiry < time() ) {
			return new WP_Error( 'token_expired', 'Preview token has expired. Click Preview again in WordPress.', array( 'status' => 403 ) );
		}

		// Check post ID matches.
		if ( (int) $token_post_id !== (int) $post_id ) {
			return new WP_Error( 'post_mismatch', 'Token does not match requested post.', array( 'status' => 403 ) );
		}

		// Verify HMAC signature.
		$payload            = $token_post_id . '|' . $token_user_id . '|' . $expiry;
		$expected_signature = hash_hmac( 'sha256', $payload, wp_salt( 'auth' ) );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return new WP_Error( 'invalid_signature', 'Token signature is invalid.', array( 'status' => 403 ) );
		}

		return true;
	}
}
