<?php
/**
 * Webhook dispatcher — fires POST on content changes.
 *
 * @package WP_Astro_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WP_Astro_Bridge_Webhook
 *
 * Hooks into transition_post_status and fires an HMAC-signed webhook
 * to a configured endpoint when posts are published, updated, trashed,
 * or unpublished.
 */
class WP_Astro_Bridge_Webhook {

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

		if ( empty( $this->options['webhook_url'] ) ) {
			return;
		}

		add_action( 'transition_post_status', array( $this, 'on_status_change' ), 10, 3 );
	}

	/**
	 * Handle post status transition.
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Old post status.
	 * @param WP_Post $post       Post object.
	 */
	public function on_status_change( $new_status, $old_status, $post ) {
		// Only public post types.
		$post_type_obj = get_post_type_object( $post->post_type );
		if ( ! $post_type_obj || ! $post_type_obj->public ) {
			return;
		}

		// Only meaningful transitions (to/from publish or trash).
		$meaningful_statuses = array( 'publish', 'trash' );
		if ( ! in_array( $new_status, $meaningful_statuses, true ) && ! in_array( $old_status, $meaningful_statuses, true ) ) {
			return;
		}

		// Debounce — prevent duplicate fires within 2 seconds.
		$transient_key = 'astro_bridge_webhook_' . $post->ID;
		if ( get_transient( $transient_key ) ) {
			return;
		}
		set_transient( $transient_key, 1, 2 );

		// Determine action.
		$action = 'post_updated';
		if ( 'publish' === $new_status && 'publish' !== $old_status ) {
			$action = 'post_published';
		} elseif ( 'trash' === $new_status ) {
			$action = 'post_trashed';
		} elseif ( 'publish' === $old_status && 'publish' !== $new_status && 'trash' !== $new_status ) {
			$action = 'post_unpublished';
		}

		$this->fire( $action, $post );
	}

	/**
	 * Send the webhook payload.
	 *
	 * @param string  $action Webhook action name.
	 * @param WP_Post $post   Post object.
	 */
	private function fire( $action, $post ) {
		$payload = array(
			'action'         => $action,
			'post_id'        => $post->ID,
			'post_type'      => $post->post_type,
			'slug'           => $post->post_name,
			'status'         => $post->post_status,
			'modified_gmt'   => get_post_modified_time( 'c', true, $post ),
			'bridge_version' => WP_ASTRO_BRIDGE_VERSION,
		);

		$body      = wp_json_encode( $payload );
		$secret    = $this->options['webhook_secret'] ?? '';
		$signature = hash_hmac( 'sha256', $body, $secret );

		wp_remote_post( $this->options['webhook_url'], array(
			'timeout'  => 5,
			'blocking' => false,
			'headers'  => array(
				'Content-Type'      => 'application/json',
				'X-Astro-Signature' => $signature,
				'X-Astro-Event'     => $action,
			),
			'body'     => $body,
		) );

		// Store last webhook info for health endpoint.
		update_option( 'wp_astro_bridge_last_webhook', array(
			'time'    => current_time( 'c' ),
			'action'  => $action,
			'post_id' => $post->ID,
		), false );
	}
}
