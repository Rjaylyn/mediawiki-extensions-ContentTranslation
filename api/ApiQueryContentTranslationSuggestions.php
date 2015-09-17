<?php
/**
 * Api module for querying translation suggestions.
 *
 * @file
 * @copyright See AUTHORS.txt
 * @license GPL-2.0+
 */

use ContentTranslation\Translator;
use ContentTranslation\Translation;
use ContentTranslation\SuggestionListManager;
use ContentTranslation\SiteMapper;

/**
 * Api module for querying translation suggestions.
 *
 * @ingroup API ContentTranslationAPI
 */
class ApiQueryContentTranslationSuggestions extends ApiQueryGeneratorBase {
	public function __construct( $query, $moduleName ) {
		parent::__construct( $query, $moduleName );
	}

	public function execute() {
		$this->run();
	}

	public function executeGenerator( $resultPageSet ) {
		$this->run( $resultPageSet );
	}

	/**
	 * @param ApiPageSet $resultPageSet
	 * TODO: Use the limit parameter
	 */
	private function run( $resultPageSet = null ) {
		$config = $this->getConfig();
		if ( !$config->get( 'ContentTranslationEnableSuggestions' ) ) {
			$this->dieUsage( 'Suggestions not enabled for this wiki', 'suggestionsdisabled' );
		}
		$params = $this->extractRequestParams();
		$result = $this->getResult();
		$user = $this->getUser();

		if ( $params['from'] === $params['to'] ) {
			$this->dieUsage(
				'Source and target languages cannot be the same. Use from, to API params.',
				'invalidparam'
			);
		}

		$translator = new Translator( $user );
		$manager = new SuggestionListManager();
		$data = $manager->getRelevantSuggestions(
			$translator,
			$params['from'],
			$params['to'],
			$params['limit']
		);

		$lists = array();
		$suggestions = $data['suggestions'];

		// Find the titles to filter out from suggestions.
		$ongoingTranslations = $this->getOngoingTranslations( $suggestions );
		$existingTitles = $this->getExistingTitles( $suggestions );
		$suggestions = $this->filterSuggestions(
			$suggestions,
			array_merge( $existingTitles, $ongoingTranslations )
		);

		// Remove the Suggestions that are no longer valid.
		$this->removeInvalidSuggestions( $params['from'], $existingTitles );

		foreach ( $data['lists'] as $list ) {
			$lists[$list->getId()] = array(
				'displayName' => $list->getDisplayNameMessage( $this->getContext() )->text(),
				'name' => $list->getName(),
				'type' => $list->getType(),
				'suggestions' => array(),
			);
			foreach ( $suggestions as $suggestion ) {
				$lists[$suggestion->getListId()]['suggestions'][] = array(
					'title' => $suggestion->getTitle()->getPrefixedText(),
					'sourceLanguage' => $suggestion->getSourceLanguage(),
					'targetLanguage' => $suggestion->getTargetLanguage(),
					'listId' => $suggestion->getListId(),
				);
			}
		}
		$result->addValue( array( 'query', $this->getModuleName() ), 'lists', $lists );
	}

	private function getOngoingTranslations( array $suggestions ) {
		$params = $this->extractRequestParams();
		$sourceLanguage = $params['from'];
		$targetLanguage = $params['to'];
		$ongoingTranslationTitles = array();
		$titles = array();
		foreach ( $suggestions as $suggestion ) {
			$titles[] = $suggestion->getTitle()->getPrefixedText();
		}
		$translations = Translation::find( $sourceLanguage, $targetLanguage, $titles );
		foreach ( $translations as $translation ) {
			// $translation['sourceTitle'] is prefixed title with spaces
			$ongoingTranslationTitles[] = $translation->translation['sourceTitle'];
		}
		return $ongoingTranslationTitles;
	}

	private function getExistingTitles( array $suggestions ) {
		$params = $this->extractRequestParams();
		$titles = array();
		$sourceLanguage = $params['from'];
		$targetLanguage = $params['to'];
		$domain = SiteMapper::getDomainCode( $sourceLanguage );
		$existingTitles = array();
		foreach ( $suggestions as $suggestion ) {
			$titles[] = $suggestion->getTitle()->getPrefixedText();
		}
		$params = array(
			'action' => 'query',
			'format' => 'json',
			'titles' => implode( '|', $titles ),
			'prop' => 'langlinks',
			'lllimit' => $params['limit'],
			'lllang' => SiteMapper::getDomainCode( $targetLanguage ),
			'redirects' => true
		);
		$apiUrl = SiteMapper::getApiURL( $sourceLanguage, $params );
		$json = Http::get( $apiUrl );
		$response = FormatJson::decode( $json, true );
		if ( !isset( $response['query'] ) || !isset( $response['query']['pages'] ) ) {
			// Something wrong with response. Should we throw exception?
			return $existingTitles;
		}

		$pages = $response['query']['pages'];
		foreach ( $pages as $page ) {
			if ( isset( $page['langlinks'] ) ) {
				// API returns titles in PrefixedText format
				$existingTitles[] = $page['title'];
			}
		}

		return $existingTitles;
	}

	private function filterSuggestions( array $suggestions, array $titlesToFilter ) {
		return array_filter( $suggestions,
			function( $suggestion ) use( $titlesToFilter ) {
				return !in_array(
					$suggestion->getTitle()->getPrefixedText(),
					$titlesToFilter
				);
			}
		);
	}

	private function removeInvalidSuggestions( $sourceLanguage, array $existingTitles ) {
		DeferredUpdates::addCallableUpdate( function() use ( $sourceLanguage, $existingTitles ) {
			// Remove the already existing links from cx_suggestion table
			$manager = new SuggestionListManager();
			$manager->removeTitles( $sourceLanguage, $existingTitles );
		} );
	}

	public function getAllowedParams() {
		$allowedParams = array(
			'from' => array(
				ApiBase::PARAM_TYPE => 'string',
				ApiBase::PARAM_REQUIRED => true,
			),
			'to' => array(
				ApiBase::PARAM_TYPE => 'string',
				ApiBase::PARAM_REQUIRED => true,
			),
			'limit' => array(
				ApiBase::PARAM_DFLT => 10,
				ApiBase::PARAM_TYPE => 'limit',
				ApiBase::PARAM_MIN => 1,
				ApiBase::PARAM_MAX => ApiBase::LIMIT_BIG1,
				ApiBase::PARAM_MAX2 => ApiBase::LIMIT_BIG2
			),
		);
		return $allowedParams;
	}

	protected function getExamplesMessages() {
		return array(
			'action=query&list=contenttranslationsuggestions&from=en&to=es' =>
				'apihelp-query+contenttranslationsuggestions-example-1',
		);
	}
}
