/**
 * ContentTranslation Tools
 * A tool that allows editors to translate pages from one language
 * to another with the help of machine translation and other translation tools
 *
 * @file
 * @ingroup Extensions
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */
( function ( $, mw ) {
	'use strict';

	var cache = {
		linkPairs: {}
	};

	/**
	 * Get the link data for a given title and language.
	 * @param {mediawiki.Api} api
	 * @param {string} title
	 * @param {string} language
	 * @return {jQuery.Promise}
	 */
	function getLink( api, title, language ) {
		var request;

		// Normalize the title
		title = mw.Title.newFromText( title ).toText();
		if ( cache[ title ] && cache[ title ][ language ] ) {
			return cache[ title ][ language ].promise();
		}

		request = api.get( {
			action: 'query',
			titles: title,
			prop: 'pageimages',
			piprop: 'thumbnail',
			pithumbsize: 150,
			redirects: true,
			format: 'json'
		}, {
			dataType: 'jsonp',
			// This prevents warnings about the unrecognized parameter "_"
			cache: true
		} );

		// Keep the request in cache
		cache[ title ] = cache[ title ] || {};
		cache[ title ][ language ] = request;

		return request.promise();
	}

	/**
	 * Fetch the link pairs
	 * @param {string|string[]} titles A title as string or array of titles
	 * @param {string} language Language to which the links are to be adapted
	 * @return {jQuery.Promise}
	 */
	function fetchLinkPairs( titles, language ) {
		var apiLanguage,
			deferred = $.Deferred();

		if ( !$.isArray( titles ) ) {
			titles = new Array( titles );
		}

		if ( language === mw.cx.sourceLanguage ) {
			apiLanguage = mw.cx.targetLanguage;
		} else {
			apiLanguage = mw.cx.sourceLanguage;
		}

		mw.cx.siteMapper.getApi( apiLanguage ).get( {
			action: 'query',
			titles: titles.join( '|' ),
			prop: 'langlinks',
			lllimit: titles.length, // TODO: Default is 10 and max is 500. Do we need more than 500?
			lllang: mw.cx.siteMapper.getWikiDomainCode( language ),
			redirects: true,
			format: 'json'
		}, {
			dataType: 'jsonp',
			// This prevents warnings about the unrecognized parameter "_"
			cache: true
		} ).done( function ( response ) {
			var redirects,
				linkPairs = {};

			if ( !response.query ) {
				deferred.resolve( {} );
				return;
			}
			redirects = jQuery.extend( {}, response.query.redirects );

			$.each( response.query.pages, function ( pageId, page ) {
				var i, key, title;

				for ( i in redirects ) {
					// Locate the title in redirects, if any.
					if ( redirects[ i ].to === page.title ) {
						key = redirects[ i ].from;
						break;
					}
				}

				if ( !key ) {
					key = page.title;
				}

				title = mw.Title.newFromText( key );

				if ( title ) {
					linkPairs[ title.toText() ] = page.langlinks &&
						page.langlinks[ 0 ][ '*' ];
				}
			} );

			// Add it to the cache
			cache.linkPairs = $.extend( cache.linkPairs, linkPairs );
			deferred.resolve( linkPairs );
		} ).fail( function ( error ) {
			mw.log( 'Error while adapting links:' + error );
			// No need to make this error visible beyond logging
			deferred.resolve( {} );
		} );

		return deferred.promise();
	}

	/**
	 * Returns the parent node of the current selection as jQuery object
	 * @return {jQuery}
	 */
	function getSelectionParent() {
		var parent, selection;

		if ( window.getSelection ) {
			selection = window.getSelection();

			if ( selection.rangeCount ) {
				parent = selection.getRangeAt( 0 ).commonAncestorContainer;
				if ( parent.nodeType !== 1 ) {
					parent = parent.parentNode;
				}
			}
		} else if ( document.selection ) {
			// IE < 9. Unlikely since we do not support old IE browsers as of now.
			selection = document.selection;

			if ( selection.type !== 'Control' ) {
				parent = selection.createRange().parentElement();
			}
		}

		return $( parent );
	}

	/**
	 * Tests whether the current selection is in a target segment
	 * @param {object} selection, the selection to test
	 * @return {boolean}
	 */
	function isValidSelection( selection ) {
		var $parent, $parentSection;

		if ( !selection || !selection.toString().length ) {
			return false;
		}

		$parent = getSelectionParent();

		// Check if parent is editable
		if ( $parent.is( '[contenteditable="false"]' ) ) {
			return false;
		}

		// Check if the text selected is text of a link. If so, that substring
		// of link text is not a valid text of any link card related actions.
		if ( $parent.is( '.cx-target-link' ) || $parent.parents( '.cx-target-link' ).length ) {
			return false;
		}

		// Check if parent is already a section. Happens when translator clear the section
		// and start from empty paragraph. No segments there, just a section parent.
		if ( $parent.is( mw.cx.getSectionSelector() ) ) {
			return true;
		}

		// Get parent section
		$parentSection = $parent.parents( '[contenteditable]' );
		// Check if that section is editable
		return $parentSection.prop( 'contenteditable' );
	}

	function removeAllHighlights() {
		// Remove existing highlights from source and translation columns. From
		// all sections.
		$( '.cx-link' ).removeClass( 'cx-highlight--blue cx-highlight--lightblue' );
		$( '.cx-target-link' ).removeClass( 'cx-highlight--blue cx-highlight--lightblue' );
	}

	/**
	 * CXLink class. Represents a generic link in CX. It can be a source or target link.
	 * It may not correspond to a link that exist in document.
	 * @param {Element} [link] An <a> element
	 * @param {Object} [options] Optional options object
	 */
	function CXLink( link, options ) {
		this.$link = $( link );
		this.options = $.extend( true, {}, CXLink.defaults, options );
		this.siteMapper = this.options.siteMapper;
		this.title = null;
		this.page = null;
		this.id = null;
	}

	CXLink.prototype.getId = function () {
		return this.id || this.$link.data( 'linkid' );
	};

	CXLink.prototype.getLink = function () {
		return this.$link;
	};

	CXLink.prototype.setId = function ( id ) {
		this.id = id;
	};

	CXLink.prototype.makeRedLink = function () {
		var selection;

		if ( !this.$link || !this.$link.length ) {
			// See if there is a selection
			mw.cx.selection.restore( 'translation' );
			selection = mw.cx.selection.get();
			// Is this selection valid and editable?
			if ( isValidSelection( selection ) ) {
				this.$link = this.createLink();
			} else {
				return;
			}
		}
		this.$link.removeClass( 'cx-target-link-unadapted' ).addClass( 'new' );
	};

	CXLink.prototype.isRedLink = function () {
		return this.$link.is( '.new' );
	};

	CXLink.prototype.setTitle = function ( title ) {
		this.title = title;
	};

	CXLink.prototype.getLanguage = function () {
		return this.language;
	};

	CXLink.prototype.getTitle = function () {
		if ( this.title ) {
			return this.title;
		}

		// It is a bit odd to use title property as mediawiki Title,
		// but it is a valid case for mediawiki links.
		this.title = this.$link ? this.$link.prop( 'title' ) : null;

		return this.title;
	};

	CXLink.prototype.getTargetTitle = function () {
		var targetTitle = cache.linkPairs[ this.getTitle() ] || this.getTitle();
		return mw.Title.newFromText( targetTitle ).toText();
	};

	/**
	 * Convert a current selection if present, if editable to a link
	 */
	CXLink.prototype.createLink = function () {
		var $link, selection;

		// Restore the selection
		mw.cx.selection.restore( 'translation' );
		selection = mw.cx.selection.get();
		$link = $( '<a>' )
			.addClass( 'cx-target-link' )
			.text( selection.toString() || this.getTargetTitle() )
			.attr( {
				title: this.getTargetTitle(),
				href: this.getTargetTitle(),
				rel: 'mw:WikiLink'
			} );

		$link.attr( 'data-linkid', this.getId() );
		mw.cx.selection.pasteHTML( $link[ 0 ].outerHTML );
		// Where did it go?
		$link = $( '.cx-column--translation a[data-linkid="' + this.getId() + '"]' );
		$link.cxTargetLink();
		this.$link.parents( '[contenteditable]' ).trigger( 'input' );

		return $link;
	};

	/**
	 * Fetch the details about a page.
	 * @return {jQuery.Promise}
	 */
	CXLink.prototype.fetchLinkData = function () {
		var api, title, self = this,
			language = this.getLanguage();

		title = this.getTitle();
		if ( !title ) {
			return;
		}

		api = this.siteMapper.getApi( language );
		return getLink( api, title, language ).then( function ( response ) {
			var pageId;

			pageId = Object.keys( response.query.pages )[ 0 ];
			if ( pageId === '-1' ) {
				// Page does not exist.
				return false;
			}
			self.page = response.query.pages[ pageId ];
			self.page.language = language;
			return self.page;
		} );
	};

	/**
	 * Get a link card
	 * @return {jQuery}
	 */
	CXLink.prototype.getLinkCard = function () {
		var $card, $link, $markMissingLink, self,
			$imageContainer, $linkContainer,
			$cardHeader, linkLanguage, linkLanguageProps, userLanguage, $linkInfo;

		self = this;
		$card = $( '<div>' )
			.addClass( 'card' );

		$imageContainer = $( '<div>' )
			.addClass( 'card__link-image-container' );
		if ( this.page ) {
			if ( this.page.thumbnail ) {
				$imageContainer.append( $( '<img>' ).attr( 'src', this.page.thumbnail.source ) );
			}
		} else {
			if ( this.isRedLink() ) {
				$card.addClass( 'redlink' );
			} else {
				$card.addClass( 'missinglink' );
			}
		}

		$linkInfo = $( '<div>' )
			.addClass( 'card__link-info' );

		$cardHeader = $( '<div>' )
			.addClass( 'card__link-header' );
		$cardHeader.append( $( '<div>' )
			.addClass( 'card__title' )
			.text(
				this.page ?
				mw.msg( 'cx-tools-link-title' ) :
				mw.msg( 'cx-tools-missing-link-title' )
			)
		);

		linkLanguage = this.getLanguage();
		linkLanguageProps = {
			lang: linkLanguage,
			dir: $.uls.data.getDir( linkLanguage )
		};

		$cardHeader.append( $( '<div>' )
			.prop( linkLanguageProps )
			.addClass( 'card__title--language' ) );

		$linkInfo.append( $cardHeader );

		$linkContainer = $( '<div>' ).addClass( 'card__link-container' );

		if ( this.page ) {
			$link = $( '<a>' )
				.addClass( 'card__link-text' )
				.text( this.page.title )
				.prop( {
					target: '_blank',
					href: this.siteMapper.getPageUrl( this.page.language, this.page.title )
				} );

			$linkContainer
				.prop( linkLanguageProps )
				.append( $link );

			$linkInfo.append( $linkContainer );
		} else {
			if ( this.isRedLink() ) {
				// This link opens Special:CX with this missing page to help translate it
				$link = $( '<a>' )
					.addClass( 'card__link-text new' )
					.text( mw.Title.newFromText( this.getTitle() ).toText() )
					.prop( {
						target: '_blank',
						title: mw.msg( 'cx-tools-missing-link-tooltip' ),
						href: new mw.Uri().extend( {
							targettitle: this.getTitle()
						} ).toString()
					} );

				$linkContainer
					.prop( linkLanguageProps )
					.append( $link );
			} else {
				userLanguage = mw.config.get( 'wgUserLanguage' );

				// This is not really a link,
				// but a message that suggests to add a red link,
				// so it must be in the UI language
				$linkContainer
					.prop( {
						lang: userLanguage,
						dir: $.uls.data.getDir( userLanguage )
					} )
					.text( mw.msg( 'cx-tools-missing-link-text' ) );

				$markMissingLink = $( '<div>' )
					.addClass( 'card__mark-missing-link' )
					.text( mw.msg( 'cx-tools-missing-link-mark-link' ) )
					.on( 'click', function () {
						self.makeRedLink();
						// Avoid bubbling
						return false;
					} );
			}
			$linkInfo.append( $linkContainer, $markMissingLink );
		}

		$card.append( $imageContainer, $linkInfo );

		return $card;
	};

	function CXSourceLink( link, options ) {
		CXLink.call( this, link, options );
		this.language = mw.cx.sourceLanguage;
		this.init();
	}

	// CXSourceLink inherits CXLink
	CXSourceLink.prototype = new CXLink();

	CXSourceLink.prototype.init = function () {
		var self = this;
		this.$link.addClass( 'cx-source-link' );
		this.listen();

		if ( this.$link.length ) {
			this.fetchLinkData().then( function ( page ) {
				if ( !page ) {
					// Mark the link in source content as missing link.
					self.makeRedLink();
				}
			} );
		}
	};

	/**
	 * Get the target link instance for the link
	 * @return {CXTargetLink}
	 */
	CXSourceLink.prototype.getTargetLink = function () {
		var $targetLink, targetLink;

		if ( this.targetLink ) {
			return this.targetLink;
		}

		$targetLink = $( '.cx-target-link[data-linkid="' + this.getId() + '"]' );

		// It is not necessary that the link exists in the document.
		// We create CXSourceLink instances out of titles(Either searched or selected)
		if ( !$targetLink.length ) {
			targetLink = new CXTargetLink();
			targetLink.setTitle( cache.linkPairs[ this.getTitle() ] || this.getTitle() );
			targetLink.setId( this.getId() );
			return targetLink;
		}

		return $targetLink.cxTargetLink().data( 'cxTargetLink' );
	};

	CXSourceLink.prototype.getCard = function () {
		var $linkInstructionSection, $linkInstructionShortcut;

		this.$card = this.getLinkCard();

		this.$card.find( '.card__title--language' )
			.text( $.uls.data.getAutonym( mw.cx.sourceLanguage ) );

		$linkInstructionSection = $( '<div>' )
			.addClass( 'card__link-instruction' );
		$linkInstructionShortcut = $( '<div>' )
			.addClass( 'shortcut-info' )
			.text( mw.msg( 'cx-tools-link-instruction-shortcut' ) );
		$linkInstructionSection.append( $linkInstructionShortcut );

		this.$card.find( '.card__link-info' ).append( $linkInstructionSection );

		return this.$card;
	};

	CXSourceLink.prototype.highlight = function () {
		// Remove existing highlights from source and translation columns. From
		// all sections.
		removeAllHighlights();
		this.$link.addClass( 'cx-highlight--blue' );
		this.getTargetLink().getLink().addClass( 'cx-highlight--lightblue' );
	};

	/**
	 * Event handler for the links in source column.
	 */
	CXSourceLink.prototype.listen = function () {
		var self = this;

		// Middle click handler for links
		this.$link.on( 'mousedown', function ( button ) {
			var url,
				$link = $( this );

			if ( button.which === 2 ) {
				url = self.siteMapper.getPageUrl(
					mw.cx.sourceLanguage, $link.prop( 'title' )
				);
				open( url, '_blank' );

				return false;
			}
		} );

		this.$link.on( 'click', function ( e ) {
			var selection, url;

			// Allow link exploration
			if ( e.shiftKey || e.ctrlKey ) {
				url = self.siteMapper.getPageUrl(
					mw.cx.sourceLanguage, self.$link.prop( 'title' )
				);
				window.open( url, '_blank' );
				return false;
			}

			mw.hook( 'mw.cx.select.link' ).fire( self.$link, mw.cx.sourceLanguage );
			self.highlight();
			selection = mw.cx.selection.get();
			// Is this selection valid and editable?
			if ( isValidSelection( selection ) ) {
				self.createLink();
			}

			// Avoid bubbling. This can bubble to a translation section focus and
			// cause link card going away.
			return false;
		} );
	};

	/**
	 * Target link class - A link in translation section
	 * @param {Element} [link]
	 * @param {Object} [options]
	 */
	function CXTargetLink( link, options ) {
		CXLink.call( this, link, options );
		this.language = mw.cx.targetLanguage;
		this.init();
	}

	// CXTargetLink inherits CXLink
	CXTargetLink.prototype = new CXLink();

	CXTargetLink.prototype.init = function () {
		this.adapt();
		this.listen();
		this.sourceLink = this.getSourceLink();
	};

	CXTargetLink.prototype.removeLink = function () {
		// Remove the link
		this.$link.after( this.$link.text() ).remove();
		// There is no link now. Stop showing the card.
		this.$card.hide();
		// restore the selection
		mw.cx.selection.restore( 'translation' );
	};

	/**
	 * Get the source link instance for the link
	 * @return {CXSourceLink}
	 */
	CXTargetLink.prototype.getSourceLink = function () {
		var $sourceLink, sourceLink;

		$sourceLink = $( '.cx-column--source .cx-link[data-linkid="' + this.getId() + '"]' );

		// It is not necessary that the link exists in the document.
		// We create CXSourceLink instances out of titles(Either searched or selected)
		if ( !$sourceLink.length ) {
			sourceLink = new CXSourceLink();
			sourceLink.setTitle( this.getTitle() );
			sourceLink.setId( this.getId() );
			return sourceLink;
		}

		return $sourceLink.cxSourceLink().data( 'cxSourceLink' );
	};

	CXTargetLink.prototype.getCard = function () {
		var self = this;

		this.$card = this.getLinkCard();
		this.$addLink = this.$removeLink = $( [] );

		this.$card.find( '.card__title--language' )
			.text( $.uls.data.getAutonym( mw.cx.targetLanguage ) );

		if ( !this.$link.length ) {
			this.$addLink = $( '<div>' )
				.addClass( 'card__add-link' )
				.text( mw.msg( 'cx-tools-link-add' ) )
				.on( 'click', function () {
					self.createLink();
					// Avoid bubbling
					return false;
				} );
		} else {
			this.$removeLink = $( '<div>' )
				.addClass( 'card__remove-link' )
				.text( mw.msg( 'cx-tools-link-remove' ) )
				.on( 'click', $.proxy( this.removeLink, this ) );
		}

		this.$card.find( '.card__link-info' )
			.append( this.$addLink, this.$removeLink );

		return this.$card;
	};

	/**
	 * Adapt the link to the target language.
	 * Assmes cache.linkPairs are already populated.
	 */
	CXTargetLink.prototype.adapt = function () {
		var title = this.getTitle();

		if ( !title ) {
			return;
		}

		if ( this.$link.hasClass( 'cx-target-link' ) ) {
			// Already adapted. Can be restrored from a saved translation(draft)
			this.adapted = true;
			this.fetchLinkData();
			return;
		}

		title = mw.Title.newFromText( title ).toText();

		if ( cache.linkPairs[ title ] ) {
			this.title = cache.linkPairs[ title ];
			this.$link.prop( {
				href: this.title,
				title: this.title
			} );
			this.adapted = true;
			this.fetchLinkData();
		} else {
			this.adapted = false;
			this.markUnAdapted();
		}

		this.$link.addClass( 'cx-target-link' );
	};

	CXTargetLink.prototype.markUnAdapted = function () {
		// All these unadapted links will be converted to plain text while publishing
		this.$link.addClass( 'cx-target-link-unadapted' );
	};

	CXTargetLink.prototype.highlight = function () {
		removeAllHighlights();
		this.$link.addClass( 'cx-highlight--blue' );
		this.getSourceLink().getLink().addClass( 'cx-highlight--lightblue' );
	};

	/**
	 * Event handler for the links in translation column.
	 */
	CXTargetLink.prototype.listen = function () {
		var self = this;

		// Middle click handler for links
		this.$link.on( 'mousedown', function ( button ) {
			var url,
				$link = $( this );

			if ( button.which === 2 ) {
				url = self.siteMapper.getPageUrl(
					mw.cx.targetLanguage, $link.prop( 'title' )
				);
				open( url, '_blank' );

				return false;
			}
		} );

		this.$link.on( 'click', function () {
			mw.hook( 'mw.cx.select.link' ).fire( self.$link, mw.cx.targetLanguage );
			self.highlight();
			// Avoid bubbling. This can bubble to a translation section focus and
			// cause link card going away.
			return false;
		} );
	};

	$.fn.cxTargetLink = function ( options ) {
		return this.each( function () {
			var $this = $( this ),
				data = $this.data( 'cxTargetLink' );

			if ( !data ) {
				$this.data( 'cxTargetLink', ( data = new CXTargetLink( this, options ) ) );
			}

			if ( typeof options === 'string' ) {
				data[ options ].call( $this );
			}
		} );
	};

	$.fn.cxSourceLink = function ( options ) {
		return this.each( function () {
			var $this = $( this ),
				data = $this.data( 'cxSourceLink' );

			if ( !data ) {
				$this.data( 'cxSourceLink', ( data = new CXSourceLink( this, options ) ) );
			}

			if ( typeof options === 'string' ) {
				data[ options ].call( $this );
			}
		} );
	};

	// Default options for CXLink
	CXLink.defaults = {
		siteMapper: mw.cx.siteMapper
	};

	/**
	 * Link Card
	 * @class
	 */
	function LinkCard() {
		this.$card = null;
		this.sourceLink = null;
		this.targetLink = null;
	}

	/**
	 * Get all applicable cards.
	 * @return {jQuery}
	 */
	LinkCard.prototype.getCard = function () {
		this.$card = $( '<div>' )
			.addClass( 'cards link' );

		this.listen();

		return this.$card;
	};

	LinkCard.prototype.listen = function () {
		var self = this;

		// Bring the card to front when clicked
		this.$card.on( 'click', '.card:first', function () {
			$( this ).insertAfter( self.$card.find( '.card:last' ) );
		} );
	};

	LinkCard.prototype.onShow = function () {
		mw.hook( 'mw.cx.tools.shown' ).fire( true );
	};

	/**
	 * Get a valid normalized title from the given text
	 * If the text is not suitable for the title, return null;
	 * Validation is done by mw.Title
	 * @param {string} text Text for the title.
	 * @return {string|null}
	 */
	function getValidTitle( text ) {
		var title = text.trim();

		title = mw.Title.newFromText( title );
		title = title && title.toText();

		return title;
	}

	/**
	 * Executed when link cards are shown, for example when a link is clicked on
	 * the source or translation column (jQuery type for link) or when a word is
	 * searched or selected in the source or translation column (string).
	 *
	 * @param {string|jQuery} link The link element or target title.
	 * @param {string} [language] The language where the link points to.
	 */
	LinkCard.prototype.start = function ( link, language ) {
		var self = this,
			$link, title;

		// link can be link text or jQuery link object
		if ( typeof link === 'string' ) {
			title = getValidTitle( link );
		} else {
			$link = link;
		}
		// If the link is a source link, restore the selection
		// in the translation column
		if ( language === mw.cx.sourceLanguage ) {
			if ( $link ) {
				this.sourceLink = $link.cxSourceLink().data( 'cxSourceLink' );
			} else {
				// Text selection in source content. Nothing to do.
				this.stop();
				return;
			}
			this.targetLink = this.sourceLink.getTargetLink();
		} else {
			if ( $link ) {
				this.targetLink = $link.cxTargetLink().data( 'cxTargetLink' );
			} else {
				// Text selection
				this.targetLink = new CXTargetLink();
				this.targetLink.setTitle( title );
				// A sufficiently good random id
				this.targetLink.setId( new Date().valueOf() );
			}
			this.sourceLink = this.targetLink.getSourceLink();
		}

		// Fetch the link data and show the card in correct order - Source card and then
		// target card.
		this.sourceLink.fetchLinkData().done( function ( page ) {
			if ( page ) {
				self.$card.append( self.sourceLink.getCard() );
			}
		} );

		this.targetLink.fetchLinkData().done( function () {
			self.$card.append( self.targetLink.getCard() );
			self.$card.show();
			self.onShow();
		} );
	};

	/**
	 * Remove the card
	 */
	LinkCard.prototype.removeCard = function () {
		removeAllHighlights();
		this.$card.remove();
	};

	LinkCard.prototype.stop = function () {
		this.removeCard();
		mw.hook( 'mw.cx.tools.shown' ).fire( false );

	};

	LinkCard.prototype.getTriggerEvents = function () {
		return [
			'mw.cx.select.link', // Select a link by clicking - in translation or source
			'mw.cx.search.link', // Search a link title using search box
			'mw.cx.select.word', // Select a word using mouse or keyboard - in translation or source
			'mw.cx.search.word' // Search a word title using search box
		];
	};

	/**
	 * Adapt links in a section
	 * @param {jQuery} $section The section.
	 */
	function adaptLinks( $section ) {
		var $sourceLinks, $targetLinks, $sourceSection, sourceLinkTargets = [];

		$sourceSection = mw.cx.getSourceSection( $section.data( 'source' ) );
		$sourceLinks = $sourceSection.find( 'a[rel="mw:WikiLink"]' );
		$targetLinks = $section.find( 'a[rel="mw:WikiLink"]' );
		if ( !$section.data( 'cx-draft' ) ) {
			// Collect all source titles
			sourceLinkTargets = $sourceLinks.map( function () {
				return $( this ).attr( 'title' );
			} ).get();
		}

		// Adapt the links to target language.
		fetchLinkPairs( sourceLinkTargets, mw.cx.targetLanguage )
			.done( function () {
				$sourceLinks.cxSourceLink();
				$targetLinks.cxTargetLink();
			} );
	}

	mw.cx.tools.link = LinkCard;

	$( function () {
		mw.hook( 'mw.cx.translation.postMT' ).add( adaptLinks );
	} );
}( jQuery, mediaWiki ) );
