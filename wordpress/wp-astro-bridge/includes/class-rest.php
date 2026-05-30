<?php
/**
 * REST API extensions — normalized SEO field, health endpoint, token verification.
 *
 * @package WP_Astro_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WP_Astro_Bridge_REST
 *
 * Registers custom REST routes and an astro_seo REST field
 * on all public post types.
 */
class WP_Astro_Bridge_REST {

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

		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'rest_api_init', array( $this, 'register_seo_field' ) );
	}

	/**
	 * Register custom REST routes.
	 */
	public function register_routes() {
		// Health endpoint.
		register_rest_route( 'astro-bridge/v1', '/health', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'health_check' ),
			'permission_callback' => '__return_true',
		) );

		// Token verification endpoint.
		//
		// Accepts both GET (query param — required by the generated Astro
		// /preview page, which fetches with ?token=...&post_id=...) and POST
		// (body / X-Astro-Preview-Token header) so newer clients can keep the
		// token out of URLs, history, referrers, and CDN/proxy logs.
		register_rest_route( 'astro-bridge/v1', '/verify-token', array(
			'methods'             => array( 'GET', 'POST' ),
			'callback'            => array( $this, 'verify_token' ),
			'permission_callback' => '__return_true',
			'args'                => array(
				'token'   => array(
					'required'          => false,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'post_id' => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		) );
	}

	/**
	 * Health check endpoint callback.
	 *
	 * @return WP_REST_Response
	 */
	public function health_check() {
		// Minimal, unauthenticated payload — just enough for the MCP server to
		// detect that the bridge plugin is installed and which version. Stack
		// fingerprinting fields (wp_version, php_version) and internal/editorial
		// data (last_webhook timing, configured URLs) are gated behind an
		// authenticated manage_options check below.
		$response = array(
			'status'         => 'ok',
			'plugin_version' => WP_ASTRO_BRIDGE_VERSION,
		);

		// Verbose diagnostics only for administrators (e.g. a logged-in admin
		// hitting the endpoint from wp-admin). Anonymous callers never see these.
		if ( current_user_can( 'manage_options' ) ) {
			$response['wp_version']      = get_bloginfo( 'version' );
			$response['php_version']     = phpversion();
			$response['astro_url']       = $this->options['astro_url'] ?? '';
			$response['webhook_url']     = ! empty( $this->options['webhook_url'] ) ? '***configured***' : '';
			$response['webhook_enabled'] = ! empty( $this->options['webhook_url'] );
			$response['preview_enabled'] = ! empty( $this->options['astro_url'] );
			$response['last_webhook']    = get_option( 'wp_astro_bridge_last_webhook', null );
			$response['timestamp']       = current_time( 'c' );
		}

		return rest_ensure_response( $response );
	}

	/**
	 * Verify preview token and return full draft post data.
	 *
	 * @param WP_REST_Request $request REST request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function verify_token( $request ) {
		$post_id = (int) $request->get_param( 'post_id' );

		// Prefer the token from a request header or POST body (keeps it out of
		// URLs, browser history, referrer headers, and proxy/CDN logs), but
		// still accept the query param for the generated Astro /preview flow.
		$token = $request->get_header( 'x_astro_preview_token' );
		if ( empty( $token ) ) {
			$token = $request->get_param( 'token' );
		}
		$token = sanitize_text_field( (string) $token );

		if ( empty( $token ) ) {
			return new WP_Error( 'invalid_token', 'Missing preview token.', array( 'status' => 403 ) );
		}

		$result = WP_Astro_Bridge_Preview::verify_token( $token, $post_id );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		// Defense-in-depth: a valid signature is NOT authorization. Re-check
		// that the user embedded in the token can still edit THIS specific post
		// right now (capabilities, post ownership, and trashed status may all
		// have changed since the token was minted). Without this, a valid HMAC
		// for any post would disclose its draft/private/trashed content.
		$token_user_id = isset( $result['user_id'] ) ? (int) $result['user_id'] : 0;
		if ( $token_user_id <= 0 || ! user_can( $token_user_id, 'edit_post', $post_id ) ) {
			return new WP_Error( 'forbidden', 'Not allowed to preview this post.', array( 'status' => 403 ) );
		}

		// Token valid and authorized — fetch post data (including drafts).
		$post = get_post( $post_id );
		if ( ! $post ) {
			return new WP_Error( 'not_found', 'Post not found.', array( 'status' => 404 ) );
		}

		// Build response similar to REST API post response.
		$author       = get_userdata( $post->post_author );
		$thumbnail_id = get_post_thumbnail_id( $post_id );
		$featured     = null;

		if ( $thumbnail_id ) {
			$img      = wp_get_attachment_image_src( $thumbnail_id, 'full' );
			$featured = array(
				'url'    => $img[0] ?? '',
				'width'  => $img[1] ?? null,
				'height' => $img[2] ?? null,
				'alt'    => get_post_meta( $thumbnail_id, '_wp_attachment_image_alt', true ),
			);
		}

		$categories = wp_get_post_terms( $post_id, 'category', array( 'fields' => 'all' ) );
		$tags       = wp_get_post_terms( $post_id, 'post_tag', array( 'fields' => 'all' ) );

		return rest_ensure_response( array(
			'id'             => $post->ID,
			'title'          => $post->post_title,
			'slug'           => $post->post_name,
			'status'         => $post->post_status,
			'date'           => get_the_date( 'c', $post ),
			'modified'       => get_the_modified_date( 'c', $post ),
			'content'        => apply_filters( 'the_content', $post->post_content ),
			'excerpt'        => $post->post_excerpt ? $post->post_excerpt : wp_trim_words( $post->post_content, 55 ),
			'author'         => $author ? array(
				'name' => $author->display_name,
				'slug' => $author->user_nicename,
			) : null,
			'featured_image' => $featured,
			'categories'     => array_map( function ( $term ) {
				return array(
					'name' => $term->name,
					'slug' => $term->slug,
				);
			}, is_array( $categories ) ? $categories : array() ),
			'tags'           => array_map( function ( $term ) {
				return array(
					'name' => $term->name,
					'slug' => $term->slug,
				);
			}, is_array( $tags ) ? $tags : array() ),
			'seo'            => $this->get_normalized_seo( $post_id ),
			'is_preview'     => true,
		) );
	}

	/**
	 * Register astro_seo REST field on all public post types.
	 */
	public function register_seo_field() {
		$post_types = get_post_types( array( 'public' => true ), 'names' );

		foreach ( $post_types as $post_type ) {
			register_rest_field( $post_type, 'astro_seo', array(
				'get_callback' => array( $this, 'get_seo_field' ),
				'schema'       => array(
					'type'        => 'object',
					'description' => 'Normalized SEO data (works with Yoast, RankMath, AIOSEO)',
					'properties'  => array(
						'title'         => array( 'type' => 'string' ),
						'description'   => array( 'type' => 'string' ),
						'canonical'     => array( 'type' => 'string' ),
						'og_image'      => array( 'type' => 'string' ),
						'robots'        => array( 'type' => 'string' ),
						'focus_keyword' => array( 'type' => 'string' ),
					),
				),
			) );
		}
	}

	/**
	 * REST field callback for astro_seo.
	 *
	 * @param array $post_arr Post data array from REST API.
	 * @return array Normalized SEO data.
	 */
	public function get_seo_field( $post_arr ) {
		return $this->get_normalized_seo( $post_arr['id'] );
	}

	/**
	 * Get normalized SEO data regardless of which SEO plugin is active.
	 *
	 * Supports Yoast SEO, Rank Math, and AIOSEO with sensible fallbacks.
	 *
	 * @param int $post_id Post ID.
	 * @return array Normalized SEO data array.
	 */
	private function get_normalized_seo( $post_id ) {
		$seo = array(
			'title'         => '',
			'description'   => '',
			'canonical'     => '',
			'og_image'      => '',
			'robots'        => 'index,follow',
			'focus_keyword' => '',
		);

		// Yoast SEO.
		if ( function_exists( 'YoastSEO' ) || defined( 'WPSEO_VERSION' ) ) {
			$seo['title']         = get_post_meta( $post_id, '_yoast_wpseo_title', true );
			$seo['description']   = get_post_meta( $post_id, '_yoast_wpseo_metadesc', true );
			$seo['canonical']     = get_post_meta( $post_id, '_yoast_wpseo_canonical', true );
			$seo['focus_keyword'] = get_post_meta( $post_id, '_yoast_wpseo_focuskw', true );

			$robots_noindex = get_post_meta( $post_id, '_yoast_wpseo_meta-robots-noindex', true );
			if ( '1' === $robots_noindex ) {
				$seo['robots'] = 'noindex,follow';
			}

			// OG image from Yoast.
			$og_image_id = get_post_meta( $post_id, '_yoast_wpseo_opengraph-image-id', true );
			if ( $og_image_id ) {
				$img = wp_get_attachment_url( $og_image_id );
				if ( $img ) {
					$seo['og_image'] = $img;
				}
			}
		}

		// Rank Math.
		if ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
			$rm_title = get_post_meta( $post_id, 'rank_math_title', true );
			$rm_desc  = get_post_meta( $post_id, 'rank_math_description', true );

			if ( $rm_title ) {
				$seo['title'] = $rm_title;
			}
			if ( $rm_desc ) {
				$seo['description'] = $rm_desc;
			}

			$rm_canonical = get_post_meta( $post_id, 'rank_math_canonical_url', true );
			if ( $rm_canonical ) {
				$seo['canonical'] = $rm_canonical;
			}

			$rm_keyword = get_post_meta( $post_id, 'rank_math_focus_keyword', true );
			if ( $rm_keyword ) {
				$seo['focus_keyword'] = $rm_keyword;
			}

			$rm_robots = get_post_meta( $post_id, 'rank_math_robots', true );
			if ( is_array( $rm_robots ) && in_array( 'noindex', $rm_robots, true ) ) {
				$seo['robots'] = 'noindex,follow';
			}

			$rm_og = get_post_meta( $post_id, 'rank_math_facebook_image', true );
			if ( $rm_og ) {
				$seo['og_image'] = $rm_og;
			}
		}

		// AIOSEO.
		if ( function_exists( 'aioseo' ) || defined( 'AIOSEO_VERSION' ) ) {
			global $wpdb;
			$table = $wpdb->prefix . 'aioseo_posts';

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$table_exists = $wpdb->get_var(
				$wpdb->prepare( 'SHOW TABLES LIKE %s', $table )
			);

			if ( $table_exists === $table ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$row = $wpdb->get_row(
					$wpdb->prepare(
						// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
						"SELECT * FROM {$table} WHERE post_id = %d",
						$post_id
					)
				);

				if ( $row ) {
					if ( ! empty( $row->title ) ) {
						$seo['title'] = $row->title;
					}
					if ( ! empty( $row->description ) ) {
						$seo['description'] = $row->description;
					}
					if ( ! empty( $row->canonical_url ) ) {
						$seo['canonical'] = $row->canonical_url;
					}
					if ( ! empty( $row->keyphrases ) ) {
						$kp = json_decode( $row->keyphrases, true );
						if ( isset( $kp['focus']['keyphrase'] ) ) {
							$seo['focus_keyword'] = $kp['focus']['keyphrase'];
						}
					}
					if ( isset( $row->robots_noindex ) && $row->robots_noindex ) {
						$seo['robots'] = 'noindex,follow';
					}
					if ( ! empty( $row->og_image_custom_url ) ) {
						$seo['og_image'] = $row->og_image_custom_url;
					}
				}
			}
		}

		// Fallbacks.
		if ( empty( $seo['title'] ) ) {
			$seo['title'] = get_the_title( $post_id );
		}
		if ( empty( $seo['canonical'] ) ) {
			$seo['canonical'] = get_permalink( $post_id );
		}
		if ( empty( $seo['og_image'] ) ) {
			$thumb_id = get_post_thumbnail_id( $post_id );
			if ( $thumb_id ) {
				$seo['og_image'] = wp_get_attachment_url( $thumb_id );
			}
		}

		return $seo;
	}
}
