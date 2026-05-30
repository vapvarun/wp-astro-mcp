<?php
/**
 * Settings page for WP Astro Bridge.
 *
 * @package WP_Astro_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WP_Astro_Bridge_Settings
 *
 * Registers the Settings API page under Settings > Astro Bridge.
 */
class WP_Astro_Bridge_Settings {

	/**
	 * Option name in wp_options.
	 *
	 * @var string
	 */
	private $option_name = 'wp_astro_bridge_settings';

	/**
	 * Constructor — hook into admin_menu and admin_init.
	 */
	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_menu' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
	}

	/**
	 * Add the settings page under the Settings menu.
	 */
	public function add_menu() {
		add_options_page(
			'WP Astro Bridge',
			'Astro Bridge',
			'manage_options',
			'wp-astro-bridge',
			array( $this, 'render_page' )
		);
	}

	/**
	 * Register settings, sections, and fields.
	 */
	public function register_settings() {
		register_setting( 'wp_astro_bridge', $this->option_name, array(
			'sanitize_callback' => array( $this, 'sanitize' ),
		) );

		add_settings_section(
			'wp_astro_bridge_main',
			'Connection Settings',
			null,
			'wp-astro-bridge'
		);

		add_settings_field( 'enabled', 'Enable Bridge', array( $this, 'field_enabled' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
		add_settings_field( 'astro_url', 'Astro Frontend URL', array( $this, 'field_astro_url' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
		add_settings_field( 'webhook_url', 'Webhook URL', array( $this, 'field_webhook_url' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
		add_settings_field( 'webhook_secret', 'Webhook Secret', array( $this, 'field_webhook_secret' ), 'wp-astro-bridge', 'wp_astro_bridge_main' );
	}

	/**
	 * Sanitize callback for settings.
	 *
	 * @param array $input Raw input values.
	 * @return array Sanitized values.
	 */
	public function sanitize( $input ) {
		$output                   = array();
		$output['enabled']        = ! empty( $input['enabled'] );
		$output['astro_url']      = esc_url_raw( rtrim( $input['astro_url'] ?? '', '/' ) );
		$output['webhook_url']    = esc_url_raw( $input['webhook_url'] ?? '' );
		$output['webhook_secret'] = sanitize_text_field( $input['webhook_secret'] ?? '' );
		return $output;
	}

	/**
	 * Render the "enabled" checkbox field.
	 */
	public function field_enabled() {
		$options = get_option( $this->option_name, array() );
		$checked = isset( $options['enabled'] ) ? (bool) $options['enabled'] : true;
		echo '<label><input type="checkbox" name="' . esc_attr( $this->option_name ) . '[enabled]" value="1" ' . checked( $checked, true, false ) . ' /> Enable webhooks and preview rewriting</label>';
	}

	/**
	 * Render the "astro_url" URL field.
	 */
	public function field_astro_url() {
		$options = get_option( $this->option_name, array() );
		$value   = $options['astro_url'] ?? '';
		echo '<input type="url" name="' . esc_attr( $this->option_name ) . '[astro_url]" value="' . esc_attr( $value ) . '" class="regular-text" placeholder="https://example.com" />';
		echo '<p class="description">The public URL of your Astro frontend.</p>';
	}

	/**
	 * Render the "webhook_url" URL field.
	 */
	public function field_webhook_url() {
		$options = get_option( $this->option_name, array() );
		$value   = $options['webhook_url'] ?? '';
		echo '<input type="url" name="' . esc_attr( $this->option_name ) . '[webhook_url]" value="' . esc_attr( $value ) . '" class="regular-text" placeholder="https://example.com/api/hook" />';
		echo '<p class="description">URL to POST when content changes (e.g., Vercel/Netlify deploy hook or Astro webhook endpoint).</p>';
	}

	/**
	 * Render the "webhook_secret" readonly password field.
	 *
	 * Rendered as type="password" rather than type="text". The value is in the
	 * DOM either way, but password type avoids shoulder-surfing and keeps the
	 * plaintext secret out of browser form-field caching/autofill.
	 */
	public function field_webhook_secret() {
		$options = get_option( $this->option_name, array() );
		$value   = $options['webhook_secret'] ?? '';
		echo '<input type="password" name="' . esc_attr( $this->option_name ) . '[webhook_secret]" value="' . esc_attr( $value ) . '" class="regular-text" readonly autocomplete="off" />';
		echo '<p class="description">Auto-generated. Used to sign webhook payloads (HMAC-SHA256). Share with your MCP server config.</p>';
	}

	/**
	 * Render the settings page.
	 */
	public function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1>WP Astro Bridge</h1>
			<p>Connect your WordPress site to an Astro frontend. <a href="https://github.com/vapvarun/wp-astro-mcp" target="_blank">Documentation</a></p>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'wp_astro_bridge' );
				do_settings_sections( 'wp-astro-bridge' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
