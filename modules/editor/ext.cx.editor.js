/**
 * ContentTranslation extension
 * A tool that allows editors to translate pages from one language
 * to another with the help of machine translation and other translation
 *
 * @file
 * @ingroup Extensions
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */
( function ( $, mw ) {
	'use strict';

	/**
	 * CXSectionEditor - Editor for each sections in the translation
	 *
	 * @class
	 */
	function CXSectionEditor( element ) {
		this.$section = $( element );
		this.$editableElement = this.$section;
		this.init();
		this.listen();
	}

	/**
	 * Initialize the editor.
	 */
	CXSectionEditor.prototype.init = function () {
		if ( this.$section.get( 0 ).tagName === 'FIGURE' ) {
			// Inside figure allow editing of caption alone
			this.$editableElement = this.$section.find( 'figcaption' );
		}

		// Make the element editable
		this.$editableElement.attr( 'contenteditable', true );
	};

	/**
	 * Section change handler.
	 */
	CXSectionEditor.prototype.onChange = function () {
		// Remove the MT/source/empty label from the section.
		// Some manual change happened.
		this.$section.data( 'cx-state', null );
		mw.hook( 'mw.cx.translation.change' ).fire( this.$section );
	};

	/**
	 * Paste handler. Adapts pasted text.
	 */
	CXSectionEditor.prototype.pasteHandler = function ( e ) {
		// Enforce plain text pasting
		var text = e.originalEvent.clipboardData.getData( 'text/plain' );

		document.execCommand( 'insertHTML', false, text );

		return false;
	};

	/**
	 * Bind event handlers.
	 */
	CXSectionEditor.prototype.listen = function () {
		var cxEditor = this;

		this.$editableElement.on( 'input', $.debounce( 200, false, function () {
			// Delay the input handler check till user pauses typing.
			// If this check is done every input,
			// the responsiveness will get affected.
			cxEditor.onChange();
		} ) );

		// Disable pressing return key in headers and figure caption
		if ( this.$editableElement.is( 'h1, h2, h3, h4, h5, h6, figcaption' ) ) {
			this.$editableElement.keypress( function ( e ) {
				return e.which !== 13; // Enter key code
			} );
		}

		this.$editableElement.on( 'paste', $.proxy( this.pasteHandler, this ) );
	};

	/**
	 * The CXSectionEditor plugin.
	 * Sets common properties on all editable elements
	 * in the translation column.
	 */
	$.fn.cxEditor = function () {
		return this.each( function () {
			var $this = $( this ),
				data = $this.data( 'cxSectionEditor' );

			if ( !data ) {
				$this.data( 'cxSectionEditor', ( data = new CXSectionEditor( this ) ) );
			}
		} );
	};
}( jQuery, mediaWiki ) );
