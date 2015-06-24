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

	/**
	 * Reference Card
	 * @class
	 */
	function ReferenceCard() {
		this.$card = null;
		this.$removeReference = null;
		this.$addReference = null;
		this.$reference = null;
	}

	/**
	 * Get the reference card
	 * @return {jQuery}
	 */
	ReferenceCard.prototype.getCard = function () {
		var $referenceInfo, $cardHeader;

		this.$card = $( '<div>' )
			.addClass( 'card reference' );
		this.$addReference = $( '<div>' )
			.addClass( 'card__add-reference' )
			.text( mw.msg( 'cx-tools-reference-add' ) );
		this.$removeReference = $( '<div>' )
			.addClass( 'card__remove-reference' )
			.text( mw.msg( 'cx-tools-reference-remove' ) );

		$referenceInfo = $( '<div>' )
			.addClass( 'card__reference-info' );
		$cardHeader = $( '<div>' )
			.addClass( 'card__reference-header' );
		$cardHeader.append( $( '<div>' )
			.addClass( 'card__title' )
			.text( mw.msg( 'cx-tools-reference-title' ) ) );
		$cardHeader.append( $( '<div>' )
			.addClass( 'card__title--language' ) );
		$referenceInfo.append( $cardHeader );
		$referenceInfo.append( $( '<div>' )
			.addClass( 'card__reference-number' ) );
		$referenceInfo.append( $( '<div>' )
			// By default the reference is in the source language and direction
			.prop( {
				lang: mw.cx.sourceLanguage,
				dir: $.uls.data.getDir( mw.cx.sourceLanguage )
			} )
			.addClass( 'card__reference-content' ) );

		$referenceInfo.append( this.$addReference, this.$removeReference );
		this.$card.append( $referenceInfo );
		this.listen();
		return this.$card;
	};

	ReferenceCard.prototype.onShow = function () {
		mw.hook( 'mw.cx.tools.shown' ).fire( true );
	};

	/**
	 * Remove the reference
	 */
	ReferenceCard.prototype.removeReference = function () {
		var $parentSection;

		if ( this.$reference ) {
			$parentSection = this.$reference.parents( '[contenteditable]' );
			$parentSection.trigger( 'input' );
			this.$reference.remove();
			this.stop();
		}
	};

	/**
	 * Add the reference to the cursor position in translation
	 */
	ReferenceCard.prototype.addReference = function () {
		var $reference, referenceId, targetReferenceId;

		mw.cx.selection.restore( 'translation' );
		$reference = this.$reference.clone();
		referenceId = $reference.prop( 'id' );
		targetReferenceId = 'cx' + referenceId;
		$reference.attr( {
			id: targetReferenceId,
			'data-sourceid': referenceId
		} );
		mw.cx.selection.pasteHTML( $reference[ 0 ].outerHTML );
		// Adapt references.
		this.adaptReference( targetReferenceId );
		// Click handler for references.
		$( document.getElementById( targetReferenceId ) )
			.on( 'click', referenceClickHandler )
			// Mark it readonly
			.attr( 'contenteditable', false );

		// Make sure we add reference list since we added a reference just now.
		this.addReferenceList();
		this.stop();
	};

	/**
	 * Event handlers
	 */
	ReferenceCard.prototype.listen = function () {
		this.$removeReference.on( 'click', $.proxy( this.removeReference, this ) );
	};

	ReferenceCard.prototype.onShow = function () {
		mw.hook( 'mw.cx.tools.shown' ).fire( true );
	};

	/**
	 * Get the reference content for the given reference Id.
	 * The content is taken from the reference list section,
	 * linked by mw-data.body.id.
	 * See https://phabricator.wikimedia.org/T88290
	 * and https://www.mediawiki.org/wiki/Parsoid/MediaWiki_DOM_spec#Ref_and_References
	 * @param {string} referenceId The reference element Identifier.
	 * @return {string} The HTML content of the reference.
	 */
	ReferenceCard.prototype.getReferenceContent = function ( referenceId ) {
		var reference, referenceContentElement;

		reference = this.getReferenceData( referenceId );
		if ( !reference || !reference.body ) {
			return null;
		}
		// Support traditional reference handling by Parsoid
		if ( reference.body.html ) {
			return reference.body.html;
		}

		referenceContentElement = document.getElementById( reference.body.id );

		return referenceContentElement && referenceContentElement.outerHTML;
	};

	/**
	 * Add the reference list(s), usually at the end of translation
	 */
	ReferenceCard.prototype.addReferenceList = function () {
		var $referenceLists, $parentSection;

		// There can be multiple reference lists grouped for notes and references
		// For example see enwiki:Hydrogen
		$referenceLists = $( '[typeof*="mw:Extension/references"]' );

		if ( !$( '.cx-column--translation [typeof*="mw:Extension/references"]' ).length ) {
			// Target reference list not added yet.
			$referenceLists.each( function ( key, referenceList ) {
				var $referenceList = $( referenceList );

				if ( $referenceList.parent().is( '.cx-column__content' ) ) {
					// Reference list is the section,
					$parentSection = $referenceList;
				} else {
					// Reference list not the section, it is wrapped inside.
					$parentSection = $referenceList.parent();
				}
				mw.hook( 'mw.cx.translation.add' ).fire( $parentSection.attr( 'id' ), 'reference' );
			} );
		}
	};

	/**
	 * Start presenting the reference card
	 * @param {string} referenceId The reference element Identifier.
	 * @param {string} language Language code of language where this reference exist.
	 */
	ReferenceCard.prototype.start = function ( referenceId, language ) {
		var $sourceReference, $targetReference, referenceContent;

		// Reference Ids are weird strings like "cite_ref-12-0", jquery fails to do look up with them
		$sourceReference = $( document.getElementById( referenceId ) );
		$targetReference = $( document.getElementById( 'cx' + referenceId ) );
		referenceContent = this.getReferenceContent( referenceId );
		if ( !referenceContent ) {
			this.stop();
			return;
		}
		this.$card.find( '.card__reference-number' )
			.text( $sourceReference.text() );
		this.$card.find( '.card__reference-content' )
			.html( referenceContent );

		if ( $targetReference.length && language === mw.cx.targetLanguage ) {
			this.$reference = $targetReference;
			this.$removeReference.on( 'click', $.proxy( this.removeReference, this ) );
			this.$addReference.remove();
		}
		if ( $sourceReference.length && language === mw.cx.sourceLanguage ) {
			this.$reference = $sourceReference;
			this.$addReference.on( 'click', $.proxy( this.addReference, this ) );
			this.$removeReference.remove();
		}
		this.$card.find( '.card__title--language' )
			.text( $.uls.data.getAutonym( language ) );
		this.$card.find( 'a' ).attr( 'target', '_blank' );
		this.onShow();
	};

	ReferenceCard.prototype.stop = function () {
		this.$card.remove();
		mw.hook( 'mw.cx.tools.shown' ).fire( false );
	};

	ReferenceCard.prototype.getTriggerEvents = function () {
		return [
			'mw.cx.select.reference',
			'mw.cx.search.reference'
		];
	};

	/**
	 * For the given reference id, get the reference data
	 *
	 * This is very easy in the cases one reference used only once in the page.
	 * Such a reference link will have data-mw carrying the data.
	 *
	 * But when the same reference used in multiple places, this is tricky.
	 * The page will have the following markup(example) at the end of page, saying all these 3
	 * references are same. One of these links will have reference data. Not necessarily
	 * first one. So we have to iterate through all these siblings and find which one has
	 * reference data.
	 *
	 * Example from Antipasto article from eswiki:
	 * <li about="#cite_note-Jöel-1" data-parsoid="{}" id="130">
	 * <span data-parsoid="{}" rel="mw:referencedBy">↑
	 * <a class="cx-link" data-linkid="132" data-parsoid="{}" href="#cite_ref-Jöel-1-0">1.0</a>
	 * <a class="cx-link" data-linkid="133" data-parsoid="{}" href="#cite_ref-Jöel-1-1">1.1</a>
	 * <a class="cx-link" data-linkid="134" data-parsoid="{}" href="#cite_ref-Jöel-1-2">1.2</a>
	 * </span>
	 * </li>
	 * @param {string} referenceId
	 * @return {Object|null}
	 */
	ReferenceCard.prototype.getReferenceData = function ( referenceId ) {
		var $sourceReference, i, mwData, $sibling, $referenceSiblings, id;

		$sourceReference = $( document.getElementById( referenceId ) );
		if ( !$sourceReference.is( '[typeof*="mw:Extension/ref"]' ) ) {
			mw.log( '[CX] Possible exploitation attempt via references. Reference ignored.' );
			return null;
		}

		$referenceSiblings = $( '[typeof*="mw:Extension/references"]' )
			.find( 'a[href="#' + referenceId + '"]' )
			.siblings()
			.addBack(); // Including self

		for ( i = 0; i < $referenceSiblings.length; i++ ) {
			id = $( $referenceSiblings[ i ] ).attr( 'href' ).replace( '#', '' );
			$sibling = $( document.getElementById( id ) );
			mwData = $sibling.data( 'mw' );
			if ( mwData && mwData.body ) {
				return mwData;
			}
		}

		// Did not see a case where we still not find reference data, but...
		return null;
	};

	/**
	 * Reference adaptation.
	 * See https://www.mediawiki.org/wiki/Parsoid/MediaWiki_DOM_spec#Ref_and_References
	 * We copy the data-mw that was adapted using the template configuration at
	 * ext.cx.source.filter.js#adaptTemplate to the $references' mwData.body.html
	 * @param {string} referenceId
	 */
	ReferenceCard.prototype.adaptReference = function ( referenceId ) {
		var $referenceContent, $targetReference,
			mwData, adaptedData;

		$targetReference = $( document.getElementById( 'cx' + referenceId ) );
		mwData = this.getReferenceData( referenceId );
		if ( !mwData || !mwData.body ) {
			return;
		}

		$referenceContent = $( '<div>' ).html( mwData.body.html );
		/*
		Reference template expands in references section as below
		<ol about="#mwt11" typeof="mw:Extension/references">
			<li about="#cite_note-1" id="cite_note-1">
				<span rel="mw:referencedBy">
					<a href="#cite_ref-1-0">↑</a>
				</span>
				<span>Reference content html goes here</span>
		</li>
		*/
		adaptedData = $( '[typeof*="mw:Extension/references"]' )
			.find( 'a[href="#' + referenceId + '"]' )
			.parent()
			.next()
			.data( 'mw' );
		$referenceContent.children().attr( 'data-mw', JSON.stringify( adaptedData ) );
		mwData.body.html = $referenceContent.html();
		$targetReference.attr( 'data-mw', JSON.stringify( mwData ) );
		this.addReferenceList();
	};

	function referenceClickHandler() {
		/*jshint validthis:true */
		var $reference = $( this );
		mw.hook( 'mw.cx.select.reference' ).fire(
			$reference.data( 'sourceid' ), mw.cx.targetLanguage );

		// Avoid bubbling of event.
		return false;
	}

	function processReferences( $section ) {
		var $sourceSection, referenceAdaptor, isRestoredFromDraft;

		isRestoredFromDraft = $section.data( 'cx-draft' ) === true;

		referenceAdaptor = new ReferenceCard();
		$section.find( '[typeof*="mw:Extension/ref"]' ).each( function () {
			var $reference = $( this ),
				referenceId;

			// Click handler for references.
			$reference
				.on( 'click', referenceClickHandler )
				// Mark it readonly
				.attr( 'contenteditable', false );
			if ( isRestoredFromDraft ) {
				// This section is restored from draft. No need of reference adaptation.
				return;
			}
			referenceId = $reference.prop( 'id' );
			$reference.attr( 'data-sourceid', referenceId );
			$reference.attr( 'id', 'cx' + referenceId );
			// Adapt references.
			referenceAdaptor.adaptReference( referenceId );
		} );

		if ( !isRestoredFromDraft && $section.is( '[typeof="mw:Extension/references"]' ) ) {
			// It is references listing. Copy data-mw that we strip before MT.
			// See https://phabricator.wikimedia.org/T75121 and
			// https://www.mediawiki.org/wiki/Parsoid/MediaWiki_DOM_spec#Ref_and_References
			$sourceSection = mw.cx.getSourceSection( $section.data( 'source' ) );
			$section.attr( 'data-mw', JSON.stringify( $sourceSection.data( 'mw' ) ) );
		}
	}

	mw.cx.tools.reference = ReferenceCard;

	$( function () {
		mw.hook( 'mw.cx.translation.postMT' ).add( processReferences );
	} );
}( jQuery, mediaWiki ) );
